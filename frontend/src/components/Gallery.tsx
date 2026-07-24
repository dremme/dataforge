import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import {
  GALLERY_OVERSCAN_ROWS,
  GALLERY_ROW_CAPTION_ESTIMATE,
  GALLERY_ROW_ESTIMATE,
  GALLERY_ROW_GAP,
} from "../gallery/layout";
import { groupIntoRows, rowCacheKey } from "../gallery/groupIntoRows";
import { useGalleryVisiblePrefetch } from "../gallery/visiblePrefetch";
import { useGalleryBackToTop } from "../hooks/useGalleryBackToTop";
import { useGalleryColumns } from "../hooks/useGalleryColumns";
import { useGalleryScrollMargin } from "../hooks/useGalleryScrollMargin";
import type { GalleryItem } from "../types";
import { GalleryBackToTop } from "./GalleryBackToTop";
import { GalleryCard } from "./GalleryCard";

interface GalleryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  selectionMode?: boolean;
  selectedPaths?: ReadonlySet<string>;
  onToggleSelect?: (path: string) => void;
}

function estimateRowSize(row: GalleryItem[]): number {
  return row.some((item) => Boolean(item.description))
    ? GALLERY_ROW_CAPTION_ESTIMATE
    : GALLERY_ROW_ESTIMATE;
}

export { GALLERY_ROW_ESTIMATE };

export function Gallery({
  items,
  onSelect,
  selectionMode = false,
  selectedPaths,
  onToggleSelect,
}: GalleryProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const columnCount = useGalleryColumns(listRef);
  const rowCount = Math.ceil(items.length / columnCount);
  const { scrollElement, scrollMargin } = useGalleryScrollMargin(listRef, [
    items.length,
    columnCount,
  ]);

  const rows = useMemo(() => groupIntoRows(items, columnCount), [columnCount, items]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateRowSize(rows[index] ?? []),
    gap: GALLERY_ROW_GAP,
    overscan: GALLERY_OVERSCAN_ROWS,
    scrollMargin,
    getItemKey: (index) => rowCacheKey(rows[index] ?? []),
    indexAttribute: "data-row-index",
    enabled: rowCount > 0,
  });

  useGalleryVisiblePrefetch(scrollElement, rows, virtualizer);
  const { visible: backToTopVisible, scrollToTop } = useGalleryBackToTop(scrollElement);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <div ref={listRef} className="gallery-virtual">
        <div
          className="gallery-virtual__inner"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowItems = rows[virtualRow.index] ?? [];

            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-row-index={virtualRow.index}
                className="gallery-row"
                style={{
                  gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  top: `${virtualRow.start - scrollMargin}px`,
                }}
              >
                {rowItems.map((item) => (
                  <GalleryCard
                    key={item.path}
                    item={item}
                    onSelect={onSelect}
                    selectionMode={selectionMode}
                    selected={selectedPaths?.has(item.path) ?? false}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <GalleryBackToTop visible={backToTopVisible} onClick={scrollToTop} />
    </>
  );
}
