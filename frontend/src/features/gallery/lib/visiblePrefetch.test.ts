import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGalleryPreviewLoaderStateForTests,
  resetGalleryPreviewLoaderForTests,
  setGalleryScrollPhase,
} from "./previewLoader";
import { collectGalleryPreviewTargets, prefetchGalleryVisibleRange } from "./visiblePrefetch";
import type { GalleryItem } from "@/shared/types";
import { HOME_PATH } from "@/test/fixtures";

function makeItem(name: string): GalleryItem {
  return {
    path: `${HOME_PATH}\\${name}`,
    name,
    modified_at: "2026-01-01T00:00:00Z",
    size: 100,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "none",
    media_type: "image",
  };
}

describe("collectGalleryPreviewTargets", () => {
  it("includes only visible rows when prefetch is disabled", () => {
    const rows: GalleryItem[][] = [
      [makeItem("row-0-a")],
      [makeItem("row-1-a")],
      [makeItem("row-2-a")],
      [makeItem("row-3-a")],
    ];

    const targets = collectGalleryPreviewTargets(
      (index) => rows[index] ?? [],
      rows.length,
      [{ index: 1 }, { index: 2 }],
      false,
    );

    expect(targets.map((target) => target.path)).toEqual([
      `${HOME_PATH}\\row-1-a`,
      `${HOME_PATH}\\row-2-a`,
    ]);
    expect(targets.every((target) => target.priority === "visible")).toBe(true);
  });
});

describe("prefetchGalleryVisibleRange", () => {
  afterEach(() => {
    resetGalleryPreviewLoaderForTests();
    vi.restoreAllMocks();
  });

  it("queues visible rows ahead of nearby prefetch rows", () => {
    const originalImage = globalThis.Image;
    const loadOrder: string[] = [];

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        loadOrder.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    const rows: GalleryItem[][] = [
      [makeItem("row-0-a"), makeItem("row-0-b")],
      [makeItem("row-1-a"), makeItem("row-1-b")],
      [makeItem("row-2-a"), makeItem("row-2-b")],
      [makeItem("row-3-a"), makeItem("row-3-b")],
      [makeItem("row-4-a"), makeItem("row-4-b")],
    ];

    prefetchGalleryVisibleRange((index) => rows[index] ?? [], rows.length, [
      { index: 2 },
      { index: 3 },
    ]);

    expect(loadOrder.some((url) => url.includes("row-2-a"))).toBe(true);
    expect(loadOrder.some((url) => url.includes("row-3-a"))).toBe(true);
    expect(getGalleryPreviewLoaderStateForTests().prefetchWaitCount).toBeGreaterThanOrEqual(0);
    globalThis.Image = originalImage;
  });

  it("limits active scrolling to the visible rows only", () => {
    const originalImage = globalThis.Image;

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        // Keep requests in-flight.
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    setGalleryScrollPhase("active");

    const rows: GalleryItem[][] = [
      [makeItem("row-0-a")],
      [makeItem("row-1-a")],
      [makeItem("row-2-a")],
      [makeItem("row-3-a")],
      [makeItem("row-4-a")],
    ];

    prefetchGalleryVisibleRange((index) => rows[index] ?? [], rows.length, [{ index: 2 }], false);

    const state = getGalleryPreviewLoaderStateForTests();
    expect(state.prefetchWaitCount).toBe(0);
    expect(state.visibleWaitCount + state.inflightCount).toBe(1);
    globalThis.Image = originalImage;
  });
});
