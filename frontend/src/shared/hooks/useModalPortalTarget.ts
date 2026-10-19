import { useSyncExternalStore } from "react";
import { getTopModalDialog, subscribeModalDialogs } from "@/shared/lib/modalDialogs";

/** App-wide feedback stays visible and interactive above the active native modal. */
export function useModalPortalTarget(active: boolean) {
  const top = useSyncExternalStore(subscribeModalDialogs, getTopModalDialog);
  return active && top && !top.classList.contains("backend-unavailable") ? top : document.body;
}
