import { getAppScrollElement } from "./layout";

/** Start loading roughly one row ahead of the viewport. */
export const GALLERY_MEDIA_LOAD_MARGIN_PX = 400;
/** Keep loaded previews until several rows outside the viewport. */
export const GALLERY_MEDIA_KEEP_MARGIN_PX = 1200;

export type GalleryMediaZonePriority = "visible" | "prefetch" | "hidden";

export interface GalleryMediaZones {
  shouldLoad: boolean;
  shouldKeep: boolean;
  priority: GalleryMediaZonePriority;
}

export function getGalleryScrollRoot(): HTMLElement | null {
  return getAppScrollElement();
}

/**
 * Scroll a container to the top in a way that survives virtualized list remeasurement.
 * Browser `behavior: "smooth"` often stalls when row heights change mid-scroll.
 */
export function scrollContainerToTop(scrollElement: HTMLElement): () => void {
  let cancelled = false;
  let rafId = 0;

  const start = scrollElement.scrollTop;
  if (start <= 0) {
    return () => {};
  }

  const previousOverflowAnchor = scrollElement.style.overflowAnchor;
  scrollElement.style.overflowAnchor = "none";

  const finish = () => {
    if (cancelled) {
      return;
    }

    scrollElement.scrollTop = 0;
    rafId = requestAnimationFrame(() => {
      if (cancelled) {
        return;
      }

      scrollElement.scrollTop = 0;
      scrollElement.style.overflowAnchor = previousOverflowAnchor;
    });
  };

  const maxDurationMs = 450;
  const minDurationMs = 180;
  const durationMs = Math.min(maxDurationMs, Math.max(minDurationMs, start * 0.12));
  const startTime = performance.now();

  const step = (now: number) => {
    if (cancelled) {
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const eased = 1 - (1 - progress) ** 3;
    scrollElement.scrollTop = Math.max(0, Math.round(start * (1 - eased)));

    if (progress < 1 && scrollElement.scrollTop > 0) {
      rafId = requestAnimationFrame(step);
      return;
    }

    finish();
  };

  rafId = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    scrollElement.style.overflowAnchor = previousOverflowAnchor;
  };
}

export function isElementInGalleryLoadZone(
  element: Element,
  root: Element | null,
  marginPx: number,
): boolean {
  const targetRect = element.getBoundingClientRect();
  if (targetRect.width === 0 && targetRect.height === 0) {
    return false;
  }

  if (root instanceof HTMLElement) {
    const rootRect = root.getBoundingClientRect();
    return (
      targetRect.bottom >= rootRect.top - marginPx && targetRect.top <= rootRect.bottom + marginPx
    );
  }

  return targetRect.bottom >= -marginPx && targetRect.top <= window.innerHeight + marginPx;
}

function isElementVisibleInRoot(element: Element, root: Element | null): boolean {
  const targetRect = element.getBoundingClientRect();

  if (root instanceof HTMLElement) {
    const rootRect = root.getBoundingClientRect();
    return targetRect.bottom > rootRect.top && targetRect.top < rootRect.bottom;
  }

  return targetRect.bottom > 0 && targetRect.top < window.innerHeight;
}

export function getGalleryMediaZones(
  element: Element,
  root: Element | null,
  isIntersectingHint = false,
): GalleryMediaZones {
  const targetRect = element.getBoundingClientRect();
  if (targetRect.width === 0 && targetRect.height === 0) {
    // Layout may not be measured yet; trust IntersectionObserver when it reports visible.
    if (isIntersectingHint) {
      return {
        shouldLoad: true,
        shouldKeep: true,
        priority: "visible",
      };
    }

    return {
      shouldLoad: false,
      shouldKeep: false,
      priority: "hidden",
    };
  }

  const shouldKeep = isElementInGalleryLoadZone(element, root, GALLERY_MEDIA_KEEP_MARGIN_PX);
  const shouldLoad = isElementInGalleryLoadZone(element, root, GALLERY_MEDIA_LOAD_MARGIN_PX);

  if (!shouldLoad) {
    return {
      shouldLoad: false,
      shouldKeep,
      priority: "hidden",
    };
  }

  return {
    shouldLoad: true,
    shouldKeep,
    priority: isElementVisibleInRoot(element, root) ? "visible" : "prefetch",
  };
}
