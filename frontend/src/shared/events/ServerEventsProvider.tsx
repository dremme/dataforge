import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { subscribeToServerEvents } from "@/shared/api/eventStream";
import type { ServerEvent } from "@/shared/types";
import {
  HIDDEN_DISCONNECT_MS,
  STREAM_STALE_MS,
  ServerEventsContext,
  type ServerEventsContextValue,
} from "./serverEvents";

/** How often the watchdog checks for silence. Coarse: it only has to notice, not react fast. */
const WATCHDOG_TICK_MS = 5_000;

/**
 * Owns the one `EventSource` for the whole app and fans it out.
 *
 * Everything that needs push shares this connection rather than opening its own,
 * because concurrent connections to one origin are a scarce, browser-wide resource.
 */
export function ServerEventsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(new Set<(event: ServerEvent) => void>());
  const lastFrameAtRef = useRef(0);

  const subscribe = useCallback((handler: (event: ServerEvent) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let close: (() => void) | null = null;
    let hiddenTimer = 0;

    const openStream = () => {
      if (disposed || close) return;

      lastFrameAtRef.current = Date.now();
      close = subscribeToServerEvents({
        onEvent: (event) => {
          // Any frame proves the stream is alive. Waiting for a heartbeat would be
          // wrong: the server only sends one when it has been idle, so a busy stream
          // never produces them and the watchdog would fire during the busiest run.
          lastFrameAtRef.current = Date.now();
          for (const handler of handlersRef.current) handler(event);
        },
        onConnectedChange: (value) => {
          if (value) lastFrameAtRef.current = Date.now();
          setConnected(value);
        },
      });
    };

    const closeStream = () => {
      close?.();
      close = null;
      setConnected(false);
    };

    const handleVisibility = () => {
      window.clearTimeout(hiddenTimer);

      if (document.visibilityState === "visible") {
        // Reopening reports a fresh connection, and consumers re-hydrate on that -
        // which is what covers whatever was missed while the stream was gone.
        openStream();
        lastFrameAtRef.current = Date.now();
        return;
      }

      hiddenTimer = window.setTimeout(closeStream, HIDDEN_DISCONNECT_MS);
    };

    if (document.visibilityState === "visible") {
      openStream();
    } else {
      hiddenTimer = window.setTimeout(closeStream, HIDDEN_DISCONNECT_MS);
    }

    // A dropped connection reports itself; a stream that stays open and silently
    // stops delivering does not, and that is what this catches. Skipped while hidden,
    // where throttled timers make elapsed wall-clock time meaningless.
    const watchdog = window.setInterval(() => {
      if (!close || document.visibilityState !== "visible") return;
      if (Date.now() - lastFrameAtRef.current <= STREAM_STALE_MS) return;

      closeStream();
      openStream();
    }, WATCHDOG_TICK_MS);

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(hiddenTimer);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", handleVisibility);
      closeStream();
    };
  }, []);

  const value = useMemo<ServerEventsContextValue>(
    () => ({ connected, subscribe }),
    [connected, subscribe],
  );

  return <ServerEventsContext.Provider value={value}>{children}</ServerEventsContext.Provider>;
}
