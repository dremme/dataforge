import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToServerEvents, type ServerEvent } from "./eventStream";

/** Minimal stand-in for the browser's EventSource, which jsdom does not implement. */
class FakeEventSource {
  static last: FakeEventSource | null = null;

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  close() {
    this.closed = true;
  }
}

function installFakeEventSource() {
  vi.stubGlobal("EventSource", FakeEventSource);
  return () => FakeEventSource.last!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = null;
});

describe("subscribeToServerEvents", () => {
  it("reports the connection opening and dropping", () => {
    const source = installFakeEventSource();
    const onConnectedChange = vi.fn();

    subscribeToServerEvents({ onEvent: vi.fn(), onConnectedChange });

    expect(source().url).toBe("/api/events");

    source().onopen!();
    expect(onConnectedChange).toHaveBeenLastCalledWith(true);

    source().onerror!();
    expect(onConnectedChange).toHaveBeenLastCalledWith(false);
  });

  it("delivers parsed events", () => {
    const source = installFakeEventSource();
    const onEvent = vi.fn();

    subscribeToServerEvents({ onEvent, onConnectedChange: vi.fn() });

    const event: ServerEvent = {
      type: "job",
      job: {
        id: "job-1",
        folder: "C:\\Photos",
        status: "running",
        total: 10,
        processed: 3,
        stats: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
    };
    source().onmessage!({ data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("ignores a frame it cannot parse rather than dropping the stream", () => {
    const source = installFakeEventSource();
    const onEvent = vi.fn();

    subscribeToServerEvents({ onEvent, onConnectedChange: vi.fn() });

    expect(() => source().onmessage!({ data: "not json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(source().closed).toBe(false);
  });

  it("closes the source and stops listening when unsubscribed", () => {
    const source = installFakeEventSource();
    const onEvent = vi.fn();

    const unsubscribe = subscribeToServerEvents({ onEvent, onConnectedChange: vi.fn() });
    unsubscribe();

    expect(source().closed).toBe(true);
    expect(source().onmessage).toBeNull();
  });

  it("stays inert where EventSource does not exist, leaving the caller to poll", () => {
    const onConnectedChange = vi.fn();

    const unsubscribe = subscribeToServerEvents({ onEvent: vi.fn(), onConnectedChange });

    expect(onConnectedChange).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
