import { useInsertionEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * A ref that always holds the last committed `value`, for callbacks registered once (listeners,
 * timers) that must not resubscribe when the value changes. Read it from effects and event
 * handlers, never during render. Insertion effects run before every layout effect, so a child's
 * layout effect calling back into the owner already sees the new value.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
