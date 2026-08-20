import { useCallback, useEffect, useMemo, useRef } from "react";
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

interface PreviewTarget {
  path: string;
  url: string;
  priority: "visible" | "prefetch";
}

export function collectGalleryPreviewTargets(
  rows: GalleryItem[][],
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
  const end = includePrefetch ? Math.min(rows.length - 1, maxIndex + after) : maxIndex;

  const targets: PreviewTarget[] = [];

  for (let index = start; index <= end; index += 1) {
    const priority = index >= minIndex && index <= maxIndex ? "visible" : "prefetch";
    for (const item of rows[index] ?? []) {
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
  rows: GalleryItem[][],
  virtualItems: { index: number }[],
  includePrefetch = true,
  neighbors?: { before?: number; after?: number },
): void {
  syncGalleryPreviewTargets(
    collectGalleryPreviewTargets(rows, virtualItems, includePrefetch, neighbors),
  );
}

function usePrefetchRange(
  scrollElement: HTMLElement | null,
  rows: GalleryItem[][],
  getVirtualItems: () => { index: number }[],
  rangeKey: unknown,
  neighbors?: { before?: number; after?: number },
): void {
  const getVirtualItemsRef = useRef(getVirtualItems);
  getVirtualItemsRef.current = getVirtualItems;

  const rafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPrefetch = useCallback(
    (includePrefetch: boolean) => {
      prefetchGalleryVisibleRange(rows, getVirtualItemsRef.current(), includePrefetch, neighbors);
    },
    [neighbors, rows],
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
  }, [rangeKey, rows.length, runPrefetch]);

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
  const rows = useMemo(() => items.map((item) => [item]), [items]);
  usePrefetchRange(
    scrollElement,
    rows,
    () => (range == null ? [] : [{ index: range.min }, { index: range.max }]),
    range == null ? "empty" : `${range.min}:${range.max}`,
    neighbors,
  );
}

export function useGalleryVisiblePrefetch(
  scrollElement: HTMLElement | null,
  rows: GalleryItem[][],
  virtualizer: Virtualizer<HTMLElement, Element>,
  neighbors?: { before?: number; after?: number },
): void {
  usePrefetchRange(
    scrollElement,
    rows,
    () => virtualizer.getVirtualItems(),
    virtualizer.scrollOffset,
    neighbors,
  );
}
