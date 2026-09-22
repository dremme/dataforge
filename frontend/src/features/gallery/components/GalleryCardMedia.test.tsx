import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import {
  getGalleryPreviewLoaderStateForTests,
  resetGalleryPreviewLoaderForTests,
  syncGalleryPreviewTargets,
} from "@/features/gallery/lib/previewLoader";
import * as galleryScrollRoot from "@/features/gallery/lib/scrollRoot";
import type { GalleryItem } from "@/shared/types";
import { GalleryCardMedia } from "./GalleryCardMedia";

const imageItem: GalleryItem = {
  name: "sunset.png",
  path: `${HOME_PATH}\\sunset.png`,
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

const visibleZones: galleryScrollRoot.GalleryMediaZones = {
  shouldLoad: true,
  shouldKeep: true,
  priority: "visible",
};

function installCompletingPreviewImages(): () => void {
  const originalImage = globalThis.Image;

  class MockImage {
    decoding = "async";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = "";

    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }

    get src() {
      return this._src;
    }
  }

  globalThis.Image = MockImage as unknown as typeof Image;
  return () => {
    globalThis.Image = originalImage;
  };
}

function installPendingPreviewImages() {
  const originalImage = globalThis.Image;
  const loads: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];

  class MockImage {
    decoding = "async";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = "";

    set src(value: string) {
      this._src = value;
      if (value) loads.push(this);
    }

    get src() {
      return this._src;
    }
  }

  globalThis.Image = MockImage as unknown as typeof Image;
  return {
    loads,
    restore: () => {
      globalThis.Image = originalImage;
    },
  };
}

describe("GalleryCardMedia", () => {
  afterEach(() => {
    resetGalleryPreviewLoaderForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "shows a card moved into view without scrolling when its preview is warmed: %s",
    async (warmed) => {
      const restoreImage = installCompletingPreviewImages();
      let top = 1600;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains("card__media-surface")
          ? new DOMRect(0, top, 200, 200)
          : new DOMRect(0, 0, 800, 600);
      });
      const intersections = new Set<() => void>();
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {
        private sync: (() => void) | undefined;

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options);
          this.observe = (target: Element) => {
            let previous: boolean | undefined;
            this.sync = () => {
              const isIntersecting = galleryScrollRoot.isElementInGalleryLoadZone(
                target,
                options?.root instanceof Element ? options.root : null,
                Number.parseFloat(options?.rootMargin ?? "0"),
              );
              if (isIntersecting === previous) return;
              previous = isIntersecting;
              callback([{ target, isIntersecting } as IntersectionObserverEntry], this);
            };
            intersections.add(this.sync);
            this.sync();
          };
        }

        disconnect() {
          if (this.sync) intersections.delete(this.sync);
        }
      };

      try {
        const { container } = render(
          <main>
            <GalleryCardMedia item={imageItem} />
          </main>,
        );
        await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        if (warmed) {
          act(() =>
            syncGalleryPreviewTargets([
              { path: imageItem.path, url: "/api/thumbnail?sample", priority: "prefetch" },
            ]),
          );
        }
        await waitFor(() => expect(container.querySelector("img[src]") !== null).toBe(warmed));
        top = 100;
        act(() => intersections.forEach((sync) => sync()));

        await waitFor(() => expect(container.querySelector("img[src]")).not.toBeNull());
        expect(container.querySelector(".card__media-placeholder")).toBeNull();

        top = 1600;
        act(() => intersections.forEach((sync) => sync()));
        expect(container.querySelector("img[src]")).not.toBeNull();
        top = 2000;
        act(() => intersections.forEach((sync) => sync()));
        expect(container.querySelector("img")).toBeNull();
      } finally {
        window.IntersectionObserver = Observer;
        restoreImage();
      }
    },
  );

  it.each(["image", "gif", "video"] as const)(
    "recovers a new %s after its first requests fail without a metadata update",
    (mediaType) => {
      vi.useFakeTimers();
      const preview = installPendingPreviewImages();
      vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

      try {
        const { container } = render(
          <GalleryCardMedia item={{ ...imageItem, media_type: mediaType }} />,
        );
        act(() => preview.loads[0].onerror?.());
        const initialUrl = container.querySelector("img")!.getAttribute("src");
        fireEvent.error(container.querySelector("img")!);
        if (mediaType !== "video") fireEvent.error(container.querySelector("img")!);

        expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
        act(() => vi.advanceTimersByTime(999));
        expect(container.querySelector("img")).toBeNull();
        act(() => vi.advanceTimersByTime(1));

        const retry = container.querySelector("img")!;
        expect(retry).not.toBeNull();
        expect(retry.getAttribute("src")).toContain("/api/thumbnail?");
        expect(retry.getAttribute("src")).not.toBe(initialUrl);
        fireEvent.load(retry);
        expect(retry).toHaveClass("card__img--ready");
        expect(container.querySelector(".card__media-placeholder")).toBeNull();
        const successfulUrl = retry.getAttribute("src");
        act(() => vi.advanceTimersByTime(60000));
        expect(retry.getAttribute("src")).toBe(successfulUrl);
      } finally {
        preview.restore();
      }
    },
  );

  it("bounds retries for unreadable media and resets them for a newer revision", () => {
    vi.useFakeTimers();
    const preview = installPendingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    try {
      const item = { ...imageItem, media_type: "video" as const, size: 100 };
      const { container, rerender } = render(<GalleryCardMedia item={item} />);
      act(() => preview.loads[0].onerror?.());

      for (const delay of [1000, 2000, 4000, 8000]) {
        fireEvent.error(container.querySelector("img")!);
        act(() => vi.advanceTimersByTime(delay - 1));
        expect(container.querySelector("img")).toBeNull();
        act(() => vi.advanceTimersByTime(1));
        expect(container.querySelector('img[src*="/api/thumbnail?"]')).not.toBeNull();
      }

      fireEvent.error(container.querySelector("img")!);
      const loads = preview.loads.length;
      act(() => vi.advanceTimersByTime(60000));
      expect(preview.loads).toHaveLength(loads);
      expect(container.querySelector("img")).toBeNull();

      rerender(<GalleryCardMedia item={{ ...item, size: 200 }} />);
      expect(container.querySelector("img")!.getAttribute("src")).toContain("v=200");
      fireEvent.error(container.querySelector("img")!);
      act(() => vi.advanceTimersByTime(1000));
      expect(container.querySelector("img")!.getAttribute("src")).toContain("v=200&retry=1");
    } finally {
      preview.restore();
    }
  });

  it("cancels the old revision's pending retry when the completed file arrives", () => {
    vi.useFakeTimers();
    const preview = installPendingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    try {
      const item = { ...imageItem, media_type: "video" as const, size: 100 };
      const { container, rerender } = render(<GalleryCardMedia item={item} />);
      act(() => preview.loads[0].onerror?.());
      fireEvent.error(container.querySelector("img")!);
      act(() => vi.advanceTimersByTime(500));

      rerender(<GalleryCardMedia item={{ ...item, size: 200 }} />);
      const completedUrl = container.querySelector("img")!.getAttribute("src");
      fireEvent.load(container.querySelector("img")!);
      act(() => vi.advanceTimersByTime(60000));
      expect(container.querySelector("img")!.getAttribute("src")).toBe(completedUrl);
      expect(completedUrl).toContain("v=200");
      expect(completedUrl).not.toContain("retry=");
    } finally {
      preview.restore();
    }
  });

  it.each(["leaves the load zone", "unmounts"])(
    "cancels pending retries when the card %s",
    (action) => {
      vi.useFakeTimers();
      const preview = installPendingPreviewImages();
      const zones = vi.spyOn(galleryScrollRoot, "getGalleryMediaZones");
      zones.mockReturnValue(visibleZones);
      let syncIntersection: () => void = () => {};
      const Observer = window.IntersectionObserver;
      window.IntersectionObserver = class extends Observer {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options);
          this.observe = (target: Element) => {
            syncIntersection = () => callback([{ target } as IntersectionObserverEntry], this);
            syncIntersection();
          };
        }
      };

      try {
        const { container, unmount } = render(
          <GalleryCardMedia item={{ ...imageItem, media_type: "video" }} />,
        );
        act(() => preview.loads[0].onerror?.());
        fireEvent.error(container.querySelector("img")!);
        act(() => vi.advanceTimersByTime(500));

        if (action === "unmounts") {
          unmount();
        } else {
          zones.mockReturnValue({ shouldLoad: false, shouldKeep: true, priority: "hidden" });
          act(syncIntersection);
        }

        const loads = preview.loads.length;
        act(() => vi.advanceTimersByTime(60000));
        expect(preview.loads).toHaveLength(loads);
        expect(container.querySelector("img")).toBeNull();

        if (action === "leaves the load zone") {
          zones.mockReturnValue(visibleZones);
          act(syncIntersection);
          act(() => vi.advanceTimersByTime(1000));
        }
        expect(container.querySelector('img[src*="/api/thumbnail?"]') !== null).toBe(
          action === "leaves the load zone",
        );
      } finally {
        window.IntersectionObserver = Observer;
        preview.restore();
      }
    },
  );

  it("marks already-complete PNGs as ready without waiting for onLoad", async () => {
    const restoreImage = installCompletingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1080);

    const { container } = render(
      <main>
        <GalleryCardMedia item={imageItem} />
      </main>,
    );

    await waitFor(() => {
      expect(container.querySelector("img.card__img--ready")).not.toBeNull();
    });

    await waitFor(() => {
      expect(getGalleryPreviewLoaderStateForTests().activeCount).toBe(0);
    });

    expect(container.querySelector(".card__media-placeholder")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("draggable")).toBe("false");
    restoreImage();
  });

  it("releases preview loader slots when a thumbnail fails and falls back to full media", async () => {
    const restoreImage = installCompletingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const { container } = render(
      <main>
        <GalleryCardMedia item={imageItem} />
      </main>,
    );

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/thumbnail"]')).not.toBeNull();
    });

    const thumbnail = container.querySelector('img[src*="/api/thumbnail"]');
    thumbnail?.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(getGalleryPreviewLoaderStateForTests().activeCount).toBe(0);
      expect(container.querySelector('img[src*="/api/media"]')).not.toBeNull();
    });

    restoreImage();
  });

  it("points at the new revision when the file is rewritten in the background", async () => {
    const restoreImage = installCompletingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const original = { ...imageItem, modified_at: "2026-06-19T12:00:00.000Z", size: 4096 };
    const { container, rerender } = render(
      <main>
        <GalleryCardMedia item={original} />
      </main>,
    );

    await waitFor(() => {
      expect(
        container.querySelector(`img[src*="v=${Date.parse(original.modified_at)}-4096"]`),
      ).not.toBeNull();
    });

    const edited = { ...original, modified_at: "2026-06-19T12:30:00.000Z", size: 5120 };
    rerender(
      <main>
        <GalleryCardMedia item={edited} />
      </main>,
    );

    await waitFor(() => {
      expect(
        container.querySelector(`img[src*="v=${Date.parse(edited.modified_at)}-5120"]`),
      ).not.toBeNull();
    });

    restoreImage();
  });

  it("retries the thumbnail for a new revision after falling back to full media", async () => {
    const restoreImage = installCompletingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const original = { ...imageItem, modified_at: "2026-06-19T12:00:00.000Z", size: 4096 };
    const { container, rerender } = render(
      <main>
        <GalleryCardMedia item={original} />
      </main>,
    );

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/thumbnail"]')).not.toBeNull();
    });

    container.querySelector('img[src*="/api/thumbnail"]')?.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/media"]')).not.toBeNull();
    });

    rerender(
      <main>
        <GalleryCardMedia item={{ ...original, modified_at: "2026-06-19T12:30:00.000Z" }} />
      </main>,
    );

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/thumbnail"]')).not.toBeNull();
    });

    restoreImage();
  });

  it("still shows the image when the preloaded thumbnail request fails", async () => {
    const preview = installPendingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const { container } = render(
      <main>
        <GalleryCardMedia item={imageItem} />
      </main>,
    );

    await waitFor(() => expect(preview.loads.length).toBe(1));

    act(() => preview.loads[0].onerror?.());

    await waitFor(() => {
      expect(container.querySelector("img[src]")).not.toBeNull();
    });

    preview.restore();
  });

  it("re-requests a preview that was cancelled while the card still wants it", async () => {
    const preview = installPendingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const { container } = render(
      <main>
        <GalleryCardMedia item={imageItem} />
      </main>,
    );

    await waitFor(() => expect(preview.loads.length).toBe(1));

    act(() => syncGalleryPreviewTargets([]));

    await waitFor(() => expect(preview.loads.length).toBe(2));

    act(() => preview.loads[1].onload?.());

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/thumbnail"]')).not.toBeNull();
    });

    preview.restore();
  });

  it("stops waiting on the loader when cancellations keep repeating", async () => {
    const preview = installPendingPreviewImages();
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const { container } = render(
      <main>
        <GalleryCardMedia item={imageItem} />
      </main>,
    );

    await waitFor(() => expect(preview.loads.length).toBe(1));

    act(() => syncGalleryPreviewTargets([]));
    await waitFor(() => expect(preview.loads.length).toBe(2));
    act(() => syncGalleryPreviewTargets([]));

    await waitFor(() => {
      expect(container.querySelector("img[src]")).not.toBeNull();
    });
    expect(preview.loads.length).toBe(2);

    preview.restore();
  });

  describe("motion media", () => {
    const gifItem: GalleryItem = {
      ...imageItem,
      name: "loop.gif",
      path: `${HOME_PATH}\\loop.gif`,
      media_type: "gif",
    };

    const videoItem: GalleryItem = {
      ...imageItem,
      name: "clip.mp4",
      path: `${HOME_PATH}\\clip.mp4`,
      media_type: "video",
    };

    it("falls back to the full GIF when its thumbnail fails", async () => {
      const preview = installPendingPreviewImages();
      vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

      const { container } = render(
        <main>
          <GalleryCardMedia item={gifItem} />
        </main>,
      );

      await waitFor(() => expect(preview.loads.length).toBe(1));
      act(() => preview.loads[0].onerror?.());

      const img = await waitFor(() => {
        const found = container.querySelector("img[src]");
        expect(found).not.toBeNull();
        return found!;
      });

      fireEvent.error(img);

      await waitFor(() => {
        expect(container.querySelector('img[src*="/api/media"]')).not.toBeNull();
      });

      preview.restore();
    });

    it("shows a placeholder instead of the full file when a video thumbnail fails", async () => {
      const preview = installPendingPreviewImages();
      vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

      const { container } = render(
        <main>
          <GalleryCardMedia item={videoItem} />
        </main>,
      );

      await waitFor(() => expect(preview.loads.length).toBe(1));
      act(() => preview.loads[0].onerror?.());

      await waitFor(() => {
        expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
      });
      expect(container.querySelector('img[src*="/api/media"]')).toBeNull();

      preview.restore();
    });
  });
});
