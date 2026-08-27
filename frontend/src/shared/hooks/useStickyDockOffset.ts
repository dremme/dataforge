import { useLayoutEffect, type RefObject } from "react";
import { getAppScrollElement } from "@/shared/lib/appScroll";

export const STICKY_DOCK_OFFSET_PROPERTY = "--sticky-dock-offset";

export function useStickyDockOffset(elementRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = elementRef.current;
    const scrollRoot = getAppScrollElement();
    if (!element || !scrollRoot) return;

    const publish = () => {
      // Border box: `contentRect` would drop the panel's padding and border.
      const { height } = element.getBoundingClientRect();
      scrollRoot.style.setProperty(STICKY_DOCK_OFFSET_PROPERTY, `${height}px`);
    };

    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(element);

    return () => {
      observer.disconnect();
      scrollRoot.style.removeProperty(STICKY_DOCK_OFFSET_PROPERTY);
    };
  }, [elementRef]);
}
