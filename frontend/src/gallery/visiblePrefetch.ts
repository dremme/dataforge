import { useCallback, useEffect, useRef } from "react";
import type { Virtualizer } from "@tanstack/virtual-core";
import {
  isGalleryScrollActive,
  setGalleryScrollPhase,
  syncGalleryPreviewTargets,
} from "./previewLoader";
import { galleryItemThumbnailPreviewUrl } from "./thumbnail";
import type { GalleryItem } from "../types";

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
): PreviewTarget[] {
  if (virtualItems.length === 0) return [];

  const minIndex = virtualItems[0].index;
  const maxIndex = virtualItems[virtualItems.length - 1].index;
  const start = includePrefetch ? Math.max(0, minIndex - PREFETCH_ROWS_BEFORE) : minIndex;
  const end = includePrefetch
    ? Math.min(rows.length - 1, maxIndex + PREFETCH_ROWS_AFTER)
    : maxIndex;

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
): void {
  syncGalleryPreviewTargets(collectGalleryPreviewTargets(rows, virtualItems, includePrefetch));
}

export function useGalleryVisiblePrefetch(
  scrollElement: HTMLElement | null,
  rows: GalleryItem[][],
  virtualizer: Virtualizer<HTMLElement, Element>,
): void {
  const rafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPrefetch = useCallback(
    (includePrefetch: boolean) => {
      prefetchGalleryVisibleRange(rows, virtualizer.getVirtualItems(), includePrefetch);
    },
    [rows, virtualizer],
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
  }, [runPrefetch, virtualizer.scrollOffset, rows.length]);

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
