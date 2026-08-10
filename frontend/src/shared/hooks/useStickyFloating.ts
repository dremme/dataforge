import { useEffect, useState, type RefObject } from "react";

/** Slack for fractional layout, so sub-pixel drift does not read as docked. */
const DOCKED_EPSILON_PX = 0.5;

function isDocked(sentinel: HTMLElement, element: HTMLElement): boolean {
  const sentinelBottom = sentinel.getBoundingClientRect().bottom;
  const elementTop = element.getBoundingClientRect().top;
  return elementTop - sentinelBottom > DOCKED_EPSILON_PX;
}

/**
 * Whether sticky positioning is currently holding `elementRef` away from the
 * sentinel marking its resting place.
 *
 * Measuring the two against each other rather than against the scroll root keeps
 * this correct for elements that dock at an offset instead of at the very top.
 * The sentinel is zero-height and sits immediately above an element with no top
 * margin, so the two edges coincide exactly while undocked.
 */
export function useStickyFloating(
  sentinelRef: RefObject<HTMLElement | null>,
  elementRef: RefObject<HTMLElement | null>,
): boolean {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const element = elementRef.current;
    if (!sentinel || !element) return;

    const scrollRoot = sentinel.closest(".main");
    if (!scrollRoot) return;

    const update = () => {
      setFloating(isDocked(sentinel, element));
    };

    update();
    scrollRoot.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    return () => {
      scrollRoot.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [elementRef, sentinelRef]);

  return floating;
}
