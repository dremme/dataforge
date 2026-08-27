import { vi } from "vitest";
import type { ServerEvent } from "@/shared/types";

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
  source: () => FakeEventSource;
  open: () => void;
  push: (event: ServerEvent | Record<string, unknown>) => void;
}

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
