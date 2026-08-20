import { useLayoutEffect, useState, type RefObject } from "react";
import { GALLERY_GAP_PX, galleryLayoutFor } from "@/features/gallery/lib/layout";
import type { GalleryDisplayMode } from "@/shared/types";

export function useGalleryColumns(
  containerRef: RefObject<HTMLElement | null>,
  displayMode: GalleryDisplayMode,
): { columnCount: number; width: number } {
  const { minColumnWidth } = galleryLayoutFor(displayMode);
  const [columnCount, setColumnCount] = useState(1);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      if (minColumnWidth === null) setColumnCount(1);
      return;
    }

    const update = () => {
      const nextWidth = element.clientWidth;
      setWidth(nextWidth);
      if (minColumnWidth === null) {
        setColumnCount(1);
        return;
      }
      setColumnCount(
        Math.max(1, Math.floor((nextWidth + GALLERY_GAP_PX) / (minColumnWidth + GALLERY_GAP_PX))),
      );
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, minColumnWidth]);

  return { columnCount, width };
}
