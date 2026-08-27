import { useMemo, useRef, type CSSProperties } from "react";
import { useGalleryBackToTop } from "@/features/gallery/hooks/useGalleryBackToTop";
import { useGalleryColumns } from "@/features/gallery/hooks/useGalleryColumns";
import { useGalleryScrollMargin } from "@/features/gallery/hooks/useGalleryScrollMargin";
import { useScrollViewport } from "@/features/gallery/hooks/useScrollViewport";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { galleryLayoutFor } from "@/features/gallery/lib/layout";
import {
  galleryColumnWidth,
  largeCardBox,
  largeCardHeight,
} from "@/features/gallery/lib/cardGeometry";
import {
  packColumnMasonry,
  visibleMasonryCards,
  type PackedMasonryCard,
  type PackedMasonryLayout,
} from "@/features/gallery/lib/packColumnMasonry";
import { useGalleryItemPrefetch } from "@/features/gallery/lib/visiblePrefetch";
import type { GalleryItem } from "@/shared/types";
import { GalleryBackToTop } from "./GalleryBackToTop";
import { GalleryCard } from "./GalleryCard";

interface GalleryMasonryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
}

const UNMEASURED: PackedMasonryLayout<GalleryItem> = { cards: [], columnCount: 1, totalHeight: 0 };

export function GalleryMasonry({ items, onSelect }: GalleryMasonryProps) {
  const { selectionMode, selectedPaths, toggleSelectedPath, extendSelectionTo } =
    useGallerySelectionContext();
  const listRef = useRef<HTMLDivElement>(null);
  const layout = galleryLayoutFor("large");
  const { columnCount, width } = useGalleryColumns(listRef, "large");
  const { scrollElement, scrollMargin } = useGalleryScrollMargin(listRef, [
    items.length,
    columnCount,
    width,
  ]);
  const { visible: backToTopVisible, scrollToTop } = useGalleryBackToTop(scrollElement);
  const viewport = useScrollViewport(scrollElement);

  const columnWidth = galleryColumnWidth(width, columnCount, layout.gap);

  // Width arrives from a layout effect; a guessed width gives scroll restore a stale layout.
  const packed = useMemo(
    () =>
      columnWidth > 0
        ? packColumnMasonry(items, {
            columnCount,
            gap: layout.gap,
            heightOf: (item) => largeCardHeight(item, columnWidth),
          })
        : UNMEASURED,
    [columnCount, columnWidth, items, layout.gap],
  );

  const overscanPx = layout.overscan * layout.rowEstimate;
  const viewHeight = viewport.height > 0 ? viewport.height : overscanPx;
  const viewTop = viewport.scrollTop - scrollMargin;
  const visibleCards = visibleMasonryCards(packed, {
    start: viewTop - overscanPx,
    end: viewTop + viewHeight + overscanPx,
  });

  const prefetchNeighbors = useMemo(
    () => ({ before: columnCount, after: columnCount * 3 }),
    [columnCount],
  );
  const prefetchRange =
    visibleCards.length === 0
      ? null
      : { min: visibleCards[0].index, max: visibleCards[visibleCards.length - 1].index };

  useGalleryItemPrefetch(scrollElement, items, prefetchRange, prefetchNeighbors);

  return (
    <>
      <div ref={listRef} className="gallery-virtual gallery-virtual--large">
        <div className="gallery-virtual__inner" style={{ height: `${packed.totalHeight}px` }}>
          {visibleCards.map((card) => (
            <MasonryCard
              key={card.item.path}
              card={card}
              columnWidth={columnWidth}
              gap={layout.gap}
              onSelect={onSelect}
              selectionMode={selectionMode}
              selected={selectedPaths.has(card.item.path)}
              onToggleSelect={toggleSelectedPath}
              onExtendSelect={extendSelectionTo}
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
  onSelect: (path: string) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (path: string) => void;
  onExtendSelect: (path: string) => void;
}

function MasonryCard({
  card,
  columnWidth,
  gap,
  onSelect,
  selectionMode,
  selected,
  onToggleSelect,
  onExtendSelect,
}: MasonryCardProps) {
  const box = largeCardBox(card.item, columnWidth);

  return (
    <div
      className="gallery-masonry-item"
      data-lane={String(card.lane)}
      style={
        {
          top: `${card.top}px`,
          left: `${card.lane * (columnWidth + gap)}px`,
          width: `${columnWidth}px`,
          height: `${card.height}px`,
          "--card-media-h": `${box.media}px`,
          "--card-body-h": `${box.body}px`,
        } as CSSProperties
      }
    >
      <GalleryCard
        item={card.item}
        onSelect={onSelect}
        displayMode="large"
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onExtendSelect={onExtendSelect}
      />
    </div>
  );
}
