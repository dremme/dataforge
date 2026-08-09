import type { ServerEvent } from "@/shared/types";
import { isServerEvent } from "@/shared/wireGuards";

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

  const source = new EventSource("/api/events");
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
