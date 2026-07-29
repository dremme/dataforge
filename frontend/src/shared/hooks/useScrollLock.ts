import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import {
  acquireScrollLock,
  releaseScrollLock,
  updateScrollLockClass,
  type ScrollLockClass,
} from "./scrollLockManager";

export { getScrollLockDepth } from "./scrollLockManager";

/**
 * Scroll lock is acquired/released in layout effects so a dialog that mounts
 * in the same commit as another unmounts can read the correct lock depth
 * for backdrop nesting (see `useOverlayBackdropClass`).
 */
export function useScrollLock(
  active: boolean,
  lockClass: ScrollLockClass = "gallery-item-modal-open",
  scrollElementRef?: RefObject<HTMLElement | null>,
): void {
  const handleRef = useRef<symbol | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      if (handleRef.current) {
        releaseScrollLock(handleRef.current);
        handleRef.current = null;
      }
      return;
    }

    const scrollElement = scrollElementRef?.current ?? null;
    handleRef.current = acquireScrollLock(lockClass, scrollElement);

    return () => {
      if (handleRef.current) {
        releaseScrollLock(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [active, lockClass, scrollElementRef]);

  useEffect(() => {
    if (!active || !handleRef.current) return;
    updateScrollLockClass(handleRef.current, lockClass);
  }, [active, lockClass]);
}
