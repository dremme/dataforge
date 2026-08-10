import { useLayoutEffect, type RefObject } from "react";
import { getAppScrollElement } from "@/shared/lib/appScroll";

/** Offset every sticky element docking below the measured element positions itself by. */
export const STICKY_DOCK_OFFSET_PROPERTY = "--sticky-dock-offset";

/**
 * Publishes the docked element's height on the scroll root as a custom property.
 *
 * A custom property rather than React state on purpose: the automation panel
 * resizes on every frame of its specs expansion, and re-rendering the virtualized
 * gallery that often would cost frames for a value only CSS ever reads.
 */
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
