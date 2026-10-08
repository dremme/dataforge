import { useLayoutEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
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
    if (minColumnWidth === null) {
      setColumnCount(1);
      setWidth(0);
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const update = () => {
      const nextWidth = element.clientWidth;
      setWidth(nextWidth);
      setColumnCount(
        Math.max(1, Math.floor((nextWidth + GALLERY_GAP_PX) / (minColumnWidth + GALLERY_GAP_PX))),
      );
    };

    // Inside the layout effect a plain update already lands before paint.
    update();

    // Observers run after layout but before paint. A plain state update renders in a later task,
    // so the old columns would be painted at the new width for a frame (opening or closing the
    // inspector); committing now skips that frame.
    const observer = new ResizeObserver(() => flushSync(update));
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef, minColumnWidth]);

  return { columnCount, width };
}
