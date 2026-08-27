import { readStored, writeStored } from "@/shared/lib/storage";
import type { ServerEvent } from "@/shared/types";
import { isServerEvent } from "@/shared/wireGuards";

const TAB_ID_KEY = "server-events-tab";

let cachedTabId: string | null = null;

export function serverEventsTabId(): string {
  if (cachedTabId) return cachedTabId;

  const stored = readStored(TAB_ID_KEY, "session");
  if (stored) {
    cachedTabId = stored;
    return stored;
  }

  const minted =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeStored(TAB_ID_KEY, minted, "session");
  cachedTabId = minted;
  return minted;
}

export interface ServerEventHandlers {
  onEvent: (event: ServerEvent) => void;
  onConnectedChange: (connected: boolean) => void;
}

export function subscribeToServerEvents({
  onEvent,
  onConnectedChange,
}: ServerEventHandlers): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  const source = new EventSource(`/api/events?tab=${encodeURIComponent(serverEventsTabId())}`);
  let warnedOnMismatch = false;

  source.onopen = () => onConnectedChange(true);
  source.onerror = () => onConnectedChange(false);
  source.onmessage = (message) => {
    let frame: unknown;
    try {
      frame = JSON.parse(message.data);
    } catch {
      return;
    }

    if (!isServerEvent(frame)) {
      // Warn once: a mismatch is a schema drift, and an unguarded frame would land as undefined.
      if (!warnedOnMismatch) {
        warnedOnMismatch = true;
        console.warn("Ignoring a server event that does not match the wire schema.");
      }
      return;
    }

    onEvent(frame);
  };

  return () => {
    source.onopen = null;
    source.onerror = null;
    source.onmessage = null;
    source.close();
  };
}
