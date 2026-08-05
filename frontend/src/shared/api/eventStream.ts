import type { ExternalOstrisJob, Job } from "@/shared/types";

/**
 * Everything `/api/events` pushes.
 *
 * Every event carries a complete current snapshot of what it describes, never a delta,
 * so a client that misses one loses nothing once the next arrives.
 */
export type ServerEvent =
  | { type: "job"; job: Job }
  | {
      type: "external_jobs";
      jobs: ExternalOstrisJob[];
      active_count: number;
      available: boolean;
    };

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
