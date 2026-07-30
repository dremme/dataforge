import { useLayoutEffect, useState } from "react";
import { getScrollLockDepth } from "./scrollLockManager";

export function overlayBackdropClass(baseClass: string, nested: boolean): string {
  return nested ? `${baseClass} ${baseClass}--nested` : baseClass;
}

/**
 * Backdrop nesting is decided once after layout cleanups of unmounted siblings
 * have run (and before this overlay acquires its own scroll lock, which must
 * use `useLayoutEffect` too). Deciding during render would still see the
 * previous dialog's lock when one confirm replaces another in the same commit
 * (e.g. TransferMediaDialog → FileImportOverwriteDialog), which dropped blur.
 */
export function useOverlayBackdropClass(baseClass: string): string {
  const [nested, setNested] = useState(false);

  useLayoutEffect(() => {
    const isNested = getScrollLockDepth() > 0;
    setNested((previous) => (previous === isNested ? previous : isNested));
    // Only the open session matters; re-running would count our own lock.
  }, []);

  return overlayBackdropClass(baseClass, nested);
}
