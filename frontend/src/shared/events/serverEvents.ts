import { createContext, useContext, useEffect, useRef } from "react";
import type { ServerEvent } from "@/shared/types";

/** How long a visible tab tolerates silence before it assumes the stream is dead. */
export const STREAM_STALE_MS = 45_000;

/**
 * How long a tab stays hidden before it gives up its stream.
 *
 * One `EventSource` is one of the ~6 connections a browser allows per origin, shared
 * across every tab, so tabs left open in the background would otherwise starve the
 * foreground one of the connections it needs for ordinary requests. A hidden tab has
 * a fallback poll and re-hydrates the moment it is shown.
 */
export const HIDDEN_DISCONNECT_MS = 60_000;

export interface ServerEventsContextValue {
  /** Whether this tab currently holds an open stream. False while hidden. */
  connected: boolean;
  subscribe: (handler: (event: ServerEvent) => void) => () => void;
}

export const ServerEventsContext = createContext<ServerEventsContextValue | null>(null);

function useServerEventsContext(): ServerEventsContextValue {
  const context = useContext(ServerEventsContext);
  if (!context) {
    throw new Error("useServerEvents must be used within ServerEventsProvider");
  }
  return context;
}

export function useStreamConnected(): boolean {
  return useServerEventsContext().connected;
}

/**
 * Run `handler` for every pushed event, for as long as the caller is mounted.
 *
 * The handler is held in a ref so a caller may pass an inline function without
 * resubscribing on every render, which would drop events in the gap.
 */
export function useServerEvent(handler: (event: ServerEvent) => void): void {
  const { subscribe } = useServerEventsContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe]);
}
