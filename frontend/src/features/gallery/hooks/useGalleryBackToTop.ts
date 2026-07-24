import { useCallback, useEffect, useRef, useState } from "react";
import { scrollContainerToTop } from "@/features/gallery/lib/scrollRoot";

/** Show once the user has scrolled past roughly one gallery row. */
export const GALLERY_BACK_TO_TOP_THRESHOLD_PX = 400;

export function useGalleryBackToTop(scrollElement: HTMLElement | null) {
  const [visible, setVisible] = useState(false);
  const cancelScrollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!scrollElement) {
      setVisible(false);
      return;
    }

    const updateVisibility = () => {
      setVisible(scrollElement.scrollTop > GALLERY_BACK_TO_TOP_THRESHOLD_PX);
    };

    updateVisibility();
    scrollElement.addEventListener("scroll", updateVisibility, { passive: true });
    return () => scrollElement.removeEventListener("scroll", updateVisibility);
  }, [scrollElement]);

  useEffect(() => {
    return () => {
      cancelScrollRef.current?.();
      cancelScrollRef.current = null;
    };
  }, [scrollElement]);

  const scrollToTop = useCallback(() => {
    if (!scrollElement) {
      return;
    }

    cancelScrollRef.current?.();
    cancelScrollRef.current = scrollContainerToTop(scrollElement);
  }, [scrollElement]);

  return { visible, scrollToTop };
}
