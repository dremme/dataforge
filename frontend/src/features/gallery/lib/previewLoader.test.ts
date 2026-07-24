import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGalleryPreviewLoaderStateForTests,
  isMediaPathWarmed,
  markMediaPathWarmed,
  requestPreviewLoad,
  resetGalleryPreviewLoaderForTests,
  setGalleryScrollPhase,
  subscribePreviewReady,
  syncGalleryPreviewTargets,
} from "./previewLoader";

describe("gallery preview cache", () => {
  afterEach(() => {
    resetGalleryPreviewLoaderForTests();
  });

  it("remembers warmed media paths across lookups", () => {
    const path = "C:\\Photos\\sunset.png";

    expect(isMediaPathWarmed(path)).toBe(false);
    markMediaPathWarmed(path);
    expect(isMediaPathWarmed(path)).toBe(true);
  });

  it("evicts the oldest warmed path when the cache exceeds its limit", () => {
    for (let index = 0; index < 501; index += 1) {
      markMediaPathWarmed(`C:\\Photos\\image-${index}.png`);
    }

    expect(isMediaPathWarmed("C:\\Photos\\image-0.png")).toBe(false);
    expect(isMediaPathWarmed("C:\\Photos\\image-500.png")).toBe(true);
  });
});

describe("galleryPreviewLoader", () => {
  afterEach(() => {
    resetGalleryPreviewLoaderForTests();
    vi.restoreAllMocks();
  });

  it("prioritizes visible requests ahead of prefetch", () => {
    const loadOrder: string[] = [];
    const originalImage = globalThis.Image;

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";

      set src(value: string) {
        this._src = value;
        const path = value.split("path=")[1] ?? value;
        loadOrder.push(path);
      }

      get src() {
        return this._src;
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    for (let index = 0; index < 24; index += 1) {
      requestPreviewLoad(`prefetch-${index}`, `/api/thumbnail?path=prefetch-${index}`, "prefetch");
    }

    requestPreviewLoad("visible-0", "/api/thumbnail?path=visible-0", "visible");

    expect(loadOrder.at(-1)).toBe("visible-0");
    globalThis.Image = originalImage;
  });

  it("keeps loading after subscribers unsubscribe", async () => {
    const originalImage = globalThis.Image;
    let finishLoad: (() => void) | undefined;

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        finishLoad = () => {
          this.onload?.();
        };
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    const ready = vi.fn();
    const unsubscribe = subscribePreviewReady("keep-loading.png", ready);
    requestPreviewLoad("keep-loading.png", "/api/thumbnail?path=keep-loading.png", "visible");

    unsubscribe();
    finishLoad?.();
    await Promise.resolve();

    expect(ready).not.toHaveBeenCalled();
    expect(getGalleryPreviewLoaderStateForTests().activeCount).toBe(0);
    globalThis.Image = originalImage;
  });

  it("notifies late subscribers when a path is already warmed", () => {
    markMediaPathWarmed("cached.png");
    const ready = vi.fn();

    subscribePreviewReady("cached.png", ready);

    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("drops stale queued work when the viewport sync changes", () => {
    const originalImage = globalThis.Image;

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        // Keep requests in-flight so queue pruning can be observed.
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    const staleTargets = [
      { path: "old-a", url: "/api/thumbnail?path=old-a", priority: "visible" as const },
      ...Array.from({ length: 30 }, (_, index) => ({
        path: `old-prefetch-${index}`,
        url: `/api/thumbnail?path=old-prefetch-${index}`,
        priority: "prefetch" as const,
      })),
    ];

    syncGalleryPreviewTargets(staleTargets);

    expect(getGalleryPreviewLoaderStateForTests().prefetchWaitCount).toBeGreaterThan(0);

    syncGalleryPreviewTargets([
      { path: "new-a", url: "/api/thumbnail?path=new-a", priority: "visible" },
    ]);

    const state = getGalleryPreviewLoaderStateForTests();
    expect(state.visibleWaitCount).toBe(0);
    expect(state.prefetchWaitCount).toBe(0);
    expect(state.inflightCount).toBe(1);
    globalThis.Image = originalImage;
  });

  it("ignores prefetch targets while scrolling is active", () => {
    setGalleryScrollPhase("active");

    syncGalleryPreviewTargets([
      { path: "visible-a", url: "/api/thumbnail?path=visible-a", priority: "visible" },
      { path: "prefetch-a", url: "/api/thumbnail?path=prefetch-a", priority: "prefetch" },
    ]);

    requestPreviewLoad("prefetch-b", "/api/thumbnail?path=prefetch-b", "prefetch");

    const state = getGalleryPreviewLoaderStateForTests();
    expect(state.scrollPhase).toBe("active");
    expect(state.prefetchWaitCount).toBe(0);
    expect(state.visibleWaitCount + state.inflightCount).toBeGreaterThan(0);
  });
});
