import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { galleryLayoutFor, type GalleryModeLayout } from "@/features/gallery/lib/layout";
import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import { groupIntoRows, rowCacheKey } from "@/features/gallery/lib/groupIntoRows";
import { useGalleryVisiblePrefetch } from "@/features/gallery/lib/visiblePrefetch";
import { useGalleryBackToTop } from "@/features/gallery/hooks/useGalleryBackToTop";
import { useGalleryColumns } from "@/features/gallery/hooks/useGalleryColumns";
import { useGalleryScrollMargin } from "@/features/gallery/hooks/useGalleryScrollMargin";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { GalleryBackToTop } from "./GalleryBackToTop";
import { GalleryCard } from "./GalleryCard";
import { GalleryListRow } from "./GalleryListRow";

interface GalleryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  displayMode?: GalleryDisplayMode;
}

function estimateRowSize(row: GalleryItem[], layout: GalleryModeLayout): number {
  return row.some((item) => Boolean(item.description))
    ? layout.captionRowEstimate
    : layout.rowEstimate;
}

export function Gallery({ items, onSelect, displayMode = DEFAULT_DISPLAY_MODE }: GalleryProps) {
  const { selectionMode, selectedPaths, toggleSelectedPath } = useGallerySelectionContext();
  const listRef = useRef<HTMLDivElement>(null);
  const layout = galleryLayoutFor(displayMode);
  const columnCount = useGalleryColumns(listRef, displayMode);
  const rowCount = Math.ceil(items.length / columnCount);
  const { scrollElement, scrollMargin } = useGalleryScrollMargin(listRef, [
    items.length,
    columnCount,
  ]);

  const rows = useMemo(() => groupIntoRows(items, columnCount), [columnCount, items]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateRowSize(rows[index] ?? [], layout),
    gap: layout.gap,
    overscan: layout.overscan,
    scrollMargin,
    getItemKey: (index) => rowCacheKey(rows[index] ?? []),
    indexAttribute: "data-row-index",
    enabled: rowCount > 0,
  });

  // Row keys are path-based, so a mode switch that happens to keep the same
  // column count (large to small in a narrow window) would otherwise reuse the
  // heights measured for the previous card size.
  const { measure } = virtualizer;
  useEffect(() => {
    measure();
  }, [displayMode, measure]);

  useGalleryVisiblePrefetch(scrollElement, rows, virtualizer);
  const { visible: backToTopVisible, scrollToTop } = useGalleryBackToTop(scrollElement);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <div ref={listRef} className={`gallery-virtual gallery-virtual--${displayMode}`}>
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
                {rowItems.map((item) =>
                  // `selected` is resolved here, not in the item, so a toggle
                  // only re-renders the one whose boolean actually changed.
                  displayMode === "list" ? (
                    <GalleryListRow
                      key={item.path}
                      item={item}
                      onSelect={onSelect}
                      selectionMode={selectionMode}
                      selected={selectedPaths.has(item.path)}
                      onToggleSelect={toggleSelectedPath}
                    />
                  ) : (
                    <GalleryCard
                      key={item.path}
                      item={item}
                      onSelect={onSelect}
                      displayMode={displayMode}
                      selectionMode={selectionMode}
                      selected={selectedPaths.has(item.path)}
                      onToggleSelect={toggleSelectedPath}
                    />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>
      <GalleryBackToTop visible={backToTopVisible} onClick={scrollToTop} />
    </>
  );
}
