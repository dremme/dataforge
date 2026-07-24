import { useRef } from "react";
import { getScrollLockDepth } from "./scrollLockManager";

export function overlayBackdropClass(baseClass: string, nested: boolean): string {
  return nested ? `${baseClass} ${baseClass}--nested` : baseClass;
}

/**
 * Backdrop nesting is decided once at mount, before this overlay acquires its
 * scroll lock. Re-checking on every render would count this overlay's own lock
 * as nesting and drop backdrop blur after unrelated background refreshes.
 */
export function useOverlayBackdropClass(baseClass: string): string {
  const nestedOnMountRef = useRef(getScrollLockDepth() > 0);
  return overlayBackdropClass(baseClass, nestedOnMountRef.current);
}
