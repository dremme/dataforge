import { useLayoutEffect, useState } from "react";

export interface ScrollViewport {
  scrollTop: number;
  height: number;
}

const AT_TOP: ScrollViewport = { scrollTop: 0, height: 0 };

/**
 * The scroll element's offset and visible height, coalesced to one update per
 * frame. Scroll events fire far faster than the browser paints and every update
 * here re-runs the visible-card search, so a scroll burst must not become a
 * burst of renders. The first read is synchronous so the initial paint already
 * knows the real window.
 */
export function useScrollViewport(scrollElement: HTMLElement | null): ScrollViewport {
  const [viewport, setViewport] = useState<ScrollViewport>(AT_TOP);

  useLayoutEffect(() => {
    if (!scrollElement) {
      setViewport((current) => (current === AT_TOP ? current : AT_TOP));
      return;
    }

    let frame: number | null = null;

    const read = () => {
      frame = null;
      const scrollTop = scrollElement.scrollTop;
      const height = scrollElement.clientHeight;
      setViewport((current) =>
        current.scrollTop === scrollTop && current.height === height
          ? current
          : { scrollTop, height },
      );
    };

    const schedule = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(read);
    };

    read();
    scrollElement.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scrollElement);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [scrollElement]);

  return viewport;
}
