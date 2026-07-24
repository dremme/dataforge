import { useLayoutEffect, useState, type RefObject } from "react";
import { getAppScrollElement } from "../gallery/layout";

function measureScrollMargin(list: HTMLElement, scrollElement: HTMLElement): number {
  return (
    list.getBoundingClientRect().top -
    scrollElement.getBoundingClientRect().top +
    scrollElement.scrollTop
  );
}

export function useGalleryScrollMargin(
  listRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[],
): { scrollElement: HTMLElement | null; scrollMargin: number } {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const main = getAppScrollElement() ?? list.closest("main");
    setScrollElement(main);
    if (!main) return;

    const updateScrollMargin = () => {
      setScrollMargin(measureScrollMargin(list, main));
    };

    updateScrollMargin();

    const resizeObserver = new ResizeObserver(updateScrollMargin);
    resizeObserver.observe(main);
    resizeObserver.observe(list);

    window.addEventListener("resize", updateScrollMargin);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollMargin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls when layout remeasures
  }, deps);

  return { scrollElement, scrollMargin };
}
