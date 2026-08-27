import { useEffect, useState, type RefObject } from "react";

/** Slack for fractional layout, so sub-pixel drift does not read as docked. */
const DOCKED_EPSILON_PX = 0.5;

function isDocked(sentinel: HTMLElement, element: HTMLElement): boolean {
  const sentinelBottom = sentinel.getBoundingClientRect().bottom;
  const elementTop = element.getBoundingClientRect().top;
  return elementTop - sentinelBottom > DOCKED_EPSILON_PX;
}

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
