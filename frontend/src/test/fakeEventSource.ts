import { vi } from "vitest";
import type { ServerEvent } from "@/shared/types";

/** Stand-in for the browser's EventSource, which jsdom does not implement. */
export class FakeEventSource {
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

export interface FakeStream {
  /** The live source. Read lazily: reconnecting replaces it. */
  source: () => FakeEventSource;
  /** Report the stream as open, which is what makes consumers hydrate. */
  open: () => void;
  /** Deliver a frame exactly as the server would write it. */
  push: (event: ServerEvent | Record<string, unknown>) => void;
}

/**
 * Install the fake as the global `EventSource` for one test.
 *
 * Frames go through `JSON.stringify` rather than being handed over as objects, so a
 * test exercises the same parse and schema check the real stream does.
 */
export function installFakeEventSource(): FakeStream {
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);

  const source = () => {
    if (!FakeEventSource.last) throw new Error("No EventSource was opened");
    return FakeEventSource.last;
  };

  return {
    source,
    open: () => source().onopen?.(),
    push: (event) => source().onmessage?.({ data: JSON.stringify(event) }),
  };
}
