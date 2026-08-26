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

/** Preview loads stay pending until the test settles them. */
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
      // An abort clears the handlers and blanks src; only real loads count.
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
    vi.restoreAllMocks();
  });

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

    // The thumbnail missed, as it can while the file is still being written.
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

    // The thumbnail 404s, as it can while a newly added file is still being written.
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

    // A row resync that does not list this path yet cancels its load — what happens
    // when an image is added in the background and the virtualizer snapshot lags it.
    act(() => syncGalleryPreviewTargets([]));

    // The card asks again rather than sitting on its placeholder forever.
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

    // Rather than retrying forever, the card hands the URL to the <img> itself.
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

      // The element's own load is what decides the fallback, and jsdom never fails
      // it on its own.
      fireEvent.error(img);

      // Unlike an MP4, a GIF does render in an `<img>`, so the miss falls back to
      // the real file rather than surrendering to a placeholder icon.
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

      // An MP4 in an `<img>` would never decode, so there is nothing to fall back to.
      await waitFor(() => {
        expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
      });
      expect(container.querySelector('img[src*="/api/media"]')).toBeNull();

      preview.restore();
    });
  });
});
