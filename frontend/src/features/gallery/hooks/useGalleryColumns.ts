import { useEffect, useState, type RefObject } from "react";
import { GALLERY_GAP_PX, galleryLayoutFor } from "@/features/gallery/lib/layout";
import type { GalleryDisplayMode } from "@/shared/types";

export function useGalleryColumns(
  containerRef: RefObject<HTMLElement | null>,
  displayMode: GalleryDisplayMode,
) {
  const { minColumnWidth } = galleryLayoutFor(displayMode);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    // A null min width means the mode is single-column by definition (list), so
    // there is nothing to measure and no observer to keep alive.
    if (minColumnWidth === null) {
      setColumnCount(1);
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const updateColumns = () => {
      const width = element.clientWidth;
      const nextCount = Math.max(
        1,
        Math.floor((width + GALLERY_GAP_PX) / (minColumnWidth + GALLERY_GAP_PX)),
      );
      setColumnCount(nextCount);
    };

    updateColumns();

    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, minColumnWidth]);

  return columnCount;
}
