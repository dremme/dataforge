import { useEffect, useState, type RefObject } from "react";

function isSentinelAboveScrollRoot(sentinel: HTMLElement, scrollRoot: Element): boolean {
  const rootTop = scrollRoot.getBoundingClientRect().top;
  const sentinelBottom = sentinel.getBoundingClientRect().bottom;
  return sentinelBottom <= rootTop;
}

export function useStickyFloating(sentinelRef: RefObject<HTMLElement | null>): boolean {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const scrollRoot = sentinel.closest(".main");
    if (!scrollRoot) return;

    const update = () => {
      setFloating(isSentinelAboveScrollRoot(sentinel, scrollRoot));
    };

    update();
    scrollRoot.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });

    return () => {
      scrollRoot.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sentinelRef]);

  return floating;
}
