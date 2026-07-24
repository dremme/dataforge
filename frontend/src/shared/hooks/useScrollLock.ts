import { useEffect, useRef, type RefObject } from "react";
import {
  acquireScrollLock,
  releaseScrollLock,
  updateScrollLockClass,
  type ScrollLockClass,
} from "./scrollLockManager";

export { getScrollLockDepth, isNestedOverlay } from "./scrollLockManager";

export function useScrollLock(
  active: boolean,
  lockClass: ScrollLockClass = "gallery-item-modal-open",
  scrollElementRef?: RefObject<HTMLElement | null>,
): void {
  const handleRef = useRef<symbol | null>(null);

  useEffect(() => {
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
