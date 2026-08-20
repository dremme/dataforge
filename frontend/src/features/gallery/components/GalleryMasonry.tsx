import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGalleryBackToTop } from "@/features/gallery/hooks/useGalleryBackToTop";
import { useGalleryColumns } from "@/features/gallery/hooks/useGalleryColumns";
import { useGalleryScrollMargin } from "@/features/gallery/hooks/useGalleryScrollMargin";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { galleryLayoutFor } from "@/features/gallery/lib/layout";
import { estimateCardHeight, galleryColumnWidth } from "@/features/gallery/lib/mediaAspect";
import {
  masonryItemOrigin,
  packColumnMasonry,
  visibleMasonryCards,
  type PackedMasonryCard,
} from "@/features/gallery/lib/packColumnMasonry";
import { useGalleryItemPrefetch } from "@/features/gallery/lib/visiblePrefetch";
import type { GalleryItem } from "@/shared/types";
import { GalleryBackToTop } from "./GalleryBackToTop";
import { GalleryCard } from "./GalleryCard";

interface GalleryMasonryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
}

export function GalleryMasonry({ items, onSelect }: GalleryMasonryProps) {
  const { selectionMode, selectedPaths, toggleSelectedPath } = useGallerySelectionContext();
  const listRef = useRef<HTMLDivElement>(null);
  const layout = galleryLayoutFor("large");
  const { columnCount, width } = useGalleryColumns(listRef, "large");
  const { scrollElement, scrollMargin } = useGalleryScrollMargin(listRef, [
    items.length,
    columnCount,
    width,
  ]);
  const { visible: backToTopVisible, scrollToTop } = useGalleryBackToTop(scrollElement);
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map<string, number>());
  const [view, setView] = useState({ scrollTop: 0, height: 0 });

  const columnWidth =
    width > 0 ? galleryColumnWidth(width, columnCount, layout.gap) : (layout.minColumnWidth ?? 280);

  const { packed, totalHeight } = useMemo(
    () =>
      packColumnMasonry(items, {
        columnCount,
        gap: layout.gap,
        heightOf: (item) =>
          measuredHeights.get(item.path) ?? estimateCardHeight(item, columnWidth, layout),
      }),
    [columnCount, columnWidth, items, layout, measuredHeights],
  );

  const overscanPx = layout.overscan * layout.rowEstimate;
  const viewHeight = view.height > 0 ? view.height : overscanPx;
  const viewStart = view.scrollTop - scrollMargin - overscanPx;
  const viewEnd = view.scrollTop - scrollMargin + viewHeight + overscanPx;
  const visibleCards = visibleMasonryCards(packed, { start: viewStart, end: viewEnd });
  const prefetchNeighbors = useMemo(
    () => ({ before: columnCount, after: columnCount * 3 }),
    [columnCount],
  );
  const prefetchRange =
    visibleCards.length === 0
      ? null
      : {
          min: visibleCards[0].index,
          max: visibleCards[visibleCards.length - 1].index,
        };

  useLayoutEffect(() => {
    if (!scrollElement) return;

    const update = () => {
      setView({ scrollTop: scrollElement.scrollTop, height: scrollElement.clientHeight });
    };

    update();
    scrollElement.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scrollElement);
    return () => {
      scrollElement.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollElement]);

  const handleHeight = useCallback((path: string, height: number) => {
    if (height <= 0) return;
    setMeasuredHeights((current) => {
      const previous = current.get(path);
      if (previous !== undefined && Math.abs(previous - height) < 1) return current;
      const next = new Map(current);
      next.set(path, height);
      return next;
    });
  }, []);

  useGalleryItemPrefetch(scrollElement, items, prefetchRange, prefetchNeighbors);

  return (
    <>
      <div ref={listRef} className="gallery-virtual gallery-virtual--large">
        <div className="gallery-virtual__inner" style={{ height: `${totalHeight}px` }}>
          {visibleCards.map((card) => (
            <MasonryCard
              key={card.item.path}
              card={card}
              columnWidth={columnWidth}
              gap={layout.gap}
              onHeight={handleHeight}
              onSelect={onSelect}
              selectionMode={selectionMode}
              selected={selectedPaths.has(card.item.path)}
              onToggleSelect={toggleSelectedPath}
            />
          ))}
        </div>
      </div>
      <GalleryBackToTop visible={backToTopVisible} onClick={scrollToTop} />
    </>
  );
}

interface MasonryCardProps {
  card: PackedMasonryCard<GalleryItem>;
  columnWidth: number;
  gap: number;
  onHeight: (path: string, height: number) => void;
  onSelect: (path: string) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (path: string) => void;
}

function MasonryCard({
  card,
  columnWidth,
  gap,
  onHeight,
  onSelect,
  selectionMode,
  selected,
  onToggleSelect,
}: MasonryCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const origin = masonryItemOrigin(card.lane, columnWidth, gap);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const report = () => onHeight(card.item.path, element.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card.item.path, onHeight]);

  return (
    <div
      ref={ref}
      className="gallery-masonry-item"
      data-lane={String(card.lane)}
      style={{
        top: `${card.top}px`,
        left: origin.left,
        width: origin.width,
      }}
    >
      <GalleryCard
        item={card.item}
        onSelect={onSelect}
        displayMode="large"
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}
