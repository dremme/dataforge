import { useEffect, useState, type RefObject } from "react";
import { GALLERY_GAP_PX, GALLERY_MIN_COLUMN_WIDTH } from "@/features/gallery/lib/layout";

export function useGalleryColumns(containerRef: RefObject<HTMLElement | null>) {
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateColumns = () => {
      const width = element.clientWidth;
      const nextCount = Math.max(
        1,
        Math.floor((width + GALLERY_GAP_PX) / (GALLERY_MIN_COLUMN_WIDTH + GALLERY_GAP_PX)),
      );
      setColumnCount(nextCount);
    };

    updateColumns();

    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return columnCount;
}
