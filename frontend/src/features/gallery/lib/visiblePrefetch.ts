import { useEffect, useMemo, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useThumbnailRuntime } from "@/features/gallery/context/thumbnailContext";
import { galleryItemThumbnailPreviewUrl, galleryItemMediaUrl } from "./thumbnail";
import type { ThumbnailDemand } from "./thumbnailStore";
import type { GalleryItem } from "@/shared/types";

export type RowAt = (index: number) => readonly GalleryItem[];
type Neighbors = { before?: number; after?: number };

export function collectGalleryPreviewTargets(
  rowAt: RowAt,
  rowCount: number,
  virtualItems: { index: number }[],
  neighbors: Neighbors = {},
): ThumbnailDemand[] {
  if (!virtualItems.length) return [];
  const min = virtualItems[0].index;
  const max = virtualItems[virtualItems.length - 1].index;
  const start = Math.max(0, min - (neighbors.before ?? 1));
  const end = Math.min(rowCount - 1, max + (neighbors.after ?? 3));
  const targets: ThumbnailDemand[] = [];
  for (let index = start; index <= end; index += 1) {
    for (const item of rowAt(index)) {
      targets.push({
        url: galleryItemThumbnailPreviewUrl(item),
        fallbackUrl: item.media_type === "video" ? undefined : galleryItemMediaUrl(item),
        priority: index >= min && index <= max ? "visible" : "prefetch",
      });
    }
  }
  return targets;
}

function usePrefetchTargets(
  scrollElement: HTMLElement | null,
  targets: readonly ThumbnailDemand[],
) {
  const { store } = useThumbnailRuntime();
  const consumer = useRef({});
  useEffect(() => {
    store.setDemand(consumer.current, targets);
  }, [store, targets]);
  useEffect(() => {
    const owner = consumer.current;
    return () => store.setDemand(owner, []);
  }, [store]);
  useEffect(() => {
    if (!scrollElement) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      store.setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => store.setScrolling(false), 150);
    };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
      store.setScrolling(false);
    };
  }, [store, scrollElement]);
}

export function useGalleryItemPrefetch(
  scrollElement: HTMLElement | null,
  items: GalleryItem[],
  range: { min: number; max: number } | null,
  neighbors?: Neighbors,
): void {
  const min = range?.min;
  const max = range?.max;
  const targets = useMemo(
    () =>
      collectGalleryPreviewTargets(
        (index) => (items[index] ? [items[index]] : []),
        items.length,
        min === undefined || max === undefined ? [] : [{ index: min }, { index: max }],
        neighbors,
      ),
    [items, min, max, neighbors],
  );
  usePrefetchTargets(scrollElement, targets);
}

export function useGalleryVisiblePrefetch(
  scrollElement: HTMLElement | null,
  rowAt: RowAt,
  rowCount: number,
  virtualizer: Virtualizer<HTMLElement, Element>,
  neighbors?: Neighbors,
): void {
  const virtualItems = virtualizer.getVirtualItems();
  const min = virtualItems[0]?.index;
  const max = virtualItems.at(-1)?.index;
  const targets = useMemo(
    () =>
      collectGalleryPreviewTargets(
        rowAt,
        rowCount,
        min === undefined || max === undefined ? [] : [{ index: min }, { index: max }],
        neighbors,
      ),
    [rowAt, rowCount, min, max, neighbors],
  );
  usePrefetchTargets(scrollElement, targets);
}
