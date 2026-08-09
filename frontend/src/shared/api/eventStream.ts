import type { ServerEvent } from "@/shared/types";

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

  source.onopen = () => onConnectedChange(true);
  source.onerror = () => onConnectedChange(false);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as ServerEvent);
    } catch {
      // One unreadable frame is not worth tearing down a working stream.
    }
  };

  return () => {
    source.onopen = null;
    source.onerror = null;
    source.onmessage = null;
    source.close();
  };
}
