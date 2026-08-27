import { useCallback, useEffect, useRef } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import {
  isGalleryScrollActive,
  setGalleryScrollPhase,
  syncGalleryPreviewTargets,
} from "./previewLoader";
import { galleryItemThumbnailPreviewUrl } from "./thumbnail";
import type { GalleryItem } from "@/shared/types";

const PREFETCH_ROWS_BEFORE = 1;
const PREFETCH_ROWS_AFTER = 3;
const SCROLL_IDLE_MS = 150;

const NO_ITEMS: readonly GalleryItem[] = [];

export type RowAt = (index: number) => readonly GalleryItem[];

interface PreviewTarget {
  path: string;
  url: string;
  priority: "visible" | "prefetch";
}

export function collectGalleryPreviewTargets(
  rowAt: RowAt,
  rowCount: number,
  virtualItems: { index: number }[],
  includePrefetch: boolean,
  neighbors: { before?: number; after?: number } = {},
): PreviewTarget[] {
  if (virtualItems.length === 0) return [];

  const before = neighbors.before ?? PREFETCH_ROWS_BEFORE;
  const after = neighbors.after ?? PREFETCH_ROWS_AFTER;
  const minIndex = virtualItems[0].index;
  const maxIndex = virtualItems[virtualItems.length - 1].index;
  const start = includePrefetch ? Math.max(0, minIndex - before) : minIndex;
  const end = includePrefetch ? Math.min(rowCount - 1, maxIndex + after) : maxIndex;

  const targets: PreviewTarget[] = [];

  for (let index = start; index <= end; index += 1) {
    const priority = index >= minIndex && index <= maxIndex ? "visible" : "prefetch";
    for (const item of rowAt(index)) {
      targets.push({
        path: item.path,
        url: galleryItemThumbnailPreviewUrl(item),
        priority,
      });
    }
  }

  return targets;
}

export function prefetchGalleryVisibleRange(
  rowAt: RowAt,
  rowCount: number,
  virtualItems: { index: number }[],
  includePrefetch = true,
  neighbors?: { before?: number; after?: number },
): void {
  syncGalleryPreviewTargets(
    collectGalleryPreviewTargets(rowAt, rowCount, virtualItems, includePrefetch, neighbors),
  );
}

function usePrefetchRange(
  scrollElement: HTMLElement | null,
  rowAt: RowAt,
  rowCount: number,
  getVirtualItems: () => { index: number }[],
  triggers: readonly unknown[],
  neighbors?: { before?: number; after?: number },
): void {
  const sourceRef = useRef({ rowAt, getVirtualItems });
  sourceRef.current = { rowAt, getVirtualItems };

  const rafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPrefetch = useCallback(
    (includePrefetch: boolean) => {
      const { rowAt: currentRowAt, getVirtualItems: currentItems } = sourceRef.current;
      prefetchGalleryVisibleRange(
        currentRowAt,
        rowCount,
        currentItems(),
        includePrefetch,
        neighbors,
      );
    },
    [neighbors, rowCount],
  );

  const markScrollActive = useCallback(() => {
    setGalleryScrollPhase("active");

    if (idleTimerRef.current != null) {
      clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      setGalleryScrollPhase("idle");
      runPrefetch(true);
    }, SCROLL_IDLE_MS);
  }, [runPrefetch]);

  useEffect(() => {
    runPrefetch(!isGalleryScrollActive());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller names its own triggers
  }, [runPrefetch, ...triggers]);

  useEffect(() => {
    if (!scrollElement) return;

    const onScroll = () => {
      markScrollActive();

      if (rafRef.current != null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        runPrefetch(false);
      });
    };

    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (idleTimerRef.current != null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      setGalleryScrollPhase("idle");
    };
  }, [markScrollActive, runPrefetch, scrollElement]);
}

export function useGalleryItemPrefetch(
  scrollElement: HTMLElement | null,
  items: GalleryItem[],
  range: { min: number; max: number } | null,
  neighbors?: { before?: number; after?: number },
): void {
  usePrefetchRange(
    scrollElement,
    (index) => {
      const item = items[index];
      return item ? [item] : NO_ITEMS;
    },
    items.length,
    () => (range == null ? [] : [{ index: range.min }, { index: range.max }]),
    [items, range == null ? "empty" : `${range.min}:${range.max}`],
    neighbors,
  );
}

export function useGalleryVisiblePrefetch(
  scrollElement: HTMLElement | null,
  rowAt: RowAt,
  rowCount: number,
  virtualizer: Virtualizer<HTMLElement, Element>,
  neighbors?: { before?: number; after?: number },
): void {
  usePrefetchRange(
    scrollElement,
    rowAt,
    rowCount,
    () => virtualizer.getVirtualItems(),
    [rowAt, virtualizer.scrollOffset],
    neighbors,
  );
}
