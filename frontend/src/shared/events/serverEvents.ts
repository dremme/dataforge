import { createContext, useContext, useEffect, useRef } from "react";
import type { ServerEvent } from "@/shared/types";

export const STREAM_STALE_MS = 45_000;
// Hidden tabs give up the stream so they do not consume a scarce per-origin EventSource slot.
export const HIDDEN_DISCONNECT_MS = 60_000;

export interface ServerEventsContextValue {
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

export function useServerEvent(handler: (event: ServerEvent) => void): void {
  const { subscribe } = useServerEventsContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe]);
}
