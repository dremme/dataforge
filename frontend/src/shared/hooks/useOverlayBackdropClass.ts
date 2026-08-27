import { useLayoutEffect, useState } from "react";
import { getScrollLockDepth } from "./scrollLockManager";

export function overlayBackdropClass(baseClass: string, nested: boolean): string {
  return nested ? `${baseClass} ${baseClass}--nested` : baseClass;
}

/** After sibling layout cleanup, before this overlay's lock; render still sees the last one. */
export function useOverlayBackdropClass(baseClass: string): string {
  const [nested, setNested] = useState(false);

  useLayoutEffect(() => {
    const isNested = getScrollLockDepth() > 0;
    setNested((previous) => (previous === isNested ? previous : isNested));
    // Only the open session; re-running would count this overlay's own lock.
  }, []);

  return overlayBackdropClass(baseClass, nested);
}
