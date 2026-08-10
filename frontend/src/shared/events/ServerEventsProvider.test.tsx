import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeEventSource } from "@/test/fakeEventSource";
import { ServerEventsProvider } from "./ServerEventsProvider";
import {
  HIDDEN_DISCONNECT_MS,
  STREAM_STALE_MS,
  useServerEvent,
  useStreamConnected,
} from "./serverEvents";

function Probe({ onState }: { onState: (state: { connected: boolean; events: number }) => void }) {
  const connected = useStreamConnected();
  const seen = { current: 0 };
  useServerEvent(() => {
    seen.current += 1;
  });
  onState({ connected, events: seen.current });
  return null;
}

function renderProvider() {
  const latest = { current: { connected: false, events: 0 } };
  render(
    <ServerEventsProvider>
      <Probe
        onState={(state) => {
          latest.current = state;
        }}
      />
    </ServerEventsProvider>,
  );
  return latest;
}

let visibility: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("visible");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ServerEventsProvider", () => {
  it("reopens a stream that stays open but stops delivering", async () => {
    const stream = installFakeEventSource();
    renderProvider();

    await act(async () => {
      stream.open();
    });
    const first = stream.source();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_STALE_MS + 10_000);
    });

    // A dropped connection reports itself; one that goes quiet does not, so silence
    // past the threshold is the only signal that it has stopped working.
    expect(first.closed).toBe(true);
    expect(stream.source()).not.toBe(first);
  });

  it("keeps a stream that is quiet but still inside the threshold", async () => {
    const stream = installFakeEventSource();
    renderProvider();

    await act(async () => {
      stream.open();
    });
    const first = stream.source();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_STALE_MS - 5_000);
    });

    expect(first.closed).toBe(false);
  });

  it("treats any frame as proof of life, not just a heartbeat", async () => {
    const stream = installFakeEventSource();
    renderProvider();

    await act(async () => {
      stream.open();
    });
    const first = stream.source();

    // A busy stream never goes idle long enough for the server to send a heartbeat,
    // so a heartbeat-only watchdog would fire during exactly the busiest run.
    for (let elapsed = 0; elapsed < STREAM_STALE_MS * 2; elapsed += 10_000) {
      await act(async () => {
        stream.push({ type: "folder", path: "C:\\Photos", fingerprint: `fp-${elapsed}` });
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    expect(first.closed).toBe(false);
  });

  it("does not trip the watchdog while the tab is hidden", async () => {
    const stream = installFakeEventSource();
    renderProvider();

    await act(async () => {
      stream.open();
    });
    const first = stream.source();

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      // Short of the hidden-disconnect timer, so any close here would be the watchdog
      // reacting to throttled wall-clock time rather than a real fault.
      await vi.advanceTimersByTimeAsync(HIDDEN_DISCONNECT_MS - 5_000);
    });

    expect(first.closed).toBe(false);
  });

  it("gives up the stream once the tab has been hidden a while, and takes it back", async () => {
    const stream = installFakeEventSource();
    const latest = renderProvider();

    await act(async () => {
      stream.open();
    });
    const first = stream.source();
    expect(latest.current.connected).toBe(true);

    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(HIDDEN_DISCONNECT_MS + 1_000);
    });

    // One of the browser's handful of per-origin connections, handed back so the
    // foreground tab can use it.
    expect(first.closed).toBe(true);
    expect(latest.current.connected).toBe(false);

    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      stream.open();
    });

    expect(stream.source()).not.toBe(first);
    expect(latest.current.connected).toBe(true);
  });
});
