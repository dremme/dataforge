import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { galleryLayoutFor, type GalleryModeLayout } from "@/features/gallery/lib/layout";
import { groupIntoRows, rowCacheKey } from "@/features/gallery/lib/groupIntoRows";
import { useGalleryVisiblePrefetch } from "@/features/gallery/lib/visiblePrefetch";
import { useGalleryBackToTop } from "@/features/gallery/hooks/useGalleryBackToTop";
import { useGalleryColumns } from "@/features/gallery/hooks/useGalleryColumns";
import { useGalleryListColumns } from "@/features/gallery/hooks/useGalleryListColumns";
import { useGalleryScrollMargin } from "@/features/gallery/hooks/useGalleryScrollMargin";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { GalleryBackToTop } from "./GalleryBackToTop";
import { GalleryCard } from "./GalleryCard";
import { GalleryListRow } from "./GalleryListRow";

interface GalleryUniformGridProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  displayMode: Exclude<GalleryDisplayMode, "large">;
}

function estimateRowSize(row: GalleryItem[], layout: GalleryModeLayout): number {
  return row.some((item) => Boolean(item.description))
    ? layout.captionRowEstimate
    : layout.rowEstimate;
}

export function GalleryUniformGrid({ items, onSelect, displayMode }: GalleryUniformGridProps) {
  const { selectionMode, selectedPaths, toggleSelectedPath, extendSelectionTo } =
    useGallerySelectionContext();
  const listRef = useRef<HTMLDivElement>(null);
  const layout = galleryLayoutFor(displayMode);
  const { columnCount } = useGalleryColumns(listRef, displayMode);
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

  // Row keys are path-based; a mode switch at the same column count would reuse old heights.
  const { measure } = virtualizer;
  useEffect(() => {
    measure();
  }, [displayMode, measure]);

  const rowAt = useCallback((index: number) => rows[index] ?? [], [rows]);
  useGalleryVisiblePrefetch(scrollElement, rowAt, rows.length, virtualizer);
  const { visible: backToTopVisible, scrollToTop } = useGalleryBackToTop(scrollElement);
  const listColumns = useGalleryListColumns(listRef, items, displayMode === "list");

  return (
    <>
      <div
        ref={listRef}
        className={`gallery-virtual gallery-virtual--${displayMode}`}
        style={listColumns}
      >
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
                  displayMode === "list" ? (
                    <GalleryListRow
                      key={item.path}
                      item={item}
                      onSelect={onSelect}
                      selectionMode={selectionMode}
                      selected={selectedPaths.has(item.path)}
                      onToggleSelect={toggleSelectedPath}
                      onExtendSelect={extendSelectionTo}
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
                      onExtendSelect={extendSelectionTo}
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
