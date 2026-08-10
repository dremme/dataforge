import { readStored, writeStored } from "@/shared/lib/storage";
import type { ServerEvent } from "@/shared/types";
import { isServerEvent } from "@/shared/wireGuards";

const TAB_ID_KEY = "server-events-tab";

let cachedTabId: string | null = null;

/**
 * This tab's identity on the push channel, so the server can address folder events
 * to the tab that is actually looking at that folder.
 *
 * `sessionStorage` is per-tab and survives a reload. The module-level memo is what
 * makes the id stable when storage is unavailable, where every read would otherwise
 * mint a new one.
 */
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
  /** Called on every connect and every drop. `EventSource` retries on its own. */
  onConnectedChange: (connected: boolean) => void;
}

/**
 * Subscribe to the server's push channel. Returns an unsubscribe function.
 *
 * Where `EventSource` does not exist the subscription is inert and never reports a
 * connection, which leaves the caller's fallback poll in charge.
 */
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
      // One unreadable frame is not worth tearing down a working stream.
      return;
    }

    if (!isServerEvent(frame)) {
      // Nothing downstream re-checks: a job frame is upserted by id and anything else
      // is read as an external-jobs frame, so a malformed one would land as `undefined`
      // rather than fail. Warn once, because a mismatch here means the two halves of
      // the app disagree about the wire format, not that a packet went bad.
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
