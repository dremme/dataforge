import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import {
  getGalleryPreviewLoaderStateForTests,
  resetGalleryPreviewLoaderForTests,
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
  issue: null,
  issue_suggestions: null,
  has_issue_file: false,
  has_bboxes: false,
  caption_status: "none",
  caption_file_type: null,
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
});
