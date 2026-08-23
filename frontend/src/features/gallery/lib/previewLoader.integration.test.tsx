import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as galleryScrollRoot from "./scrollRoot";
import {
  getGalleryPreviewLoaderStateForTests,
  resetGalleryPreviewLoaderForTests,
  setGalleryScrollPhase,
  syncGalleryPreviewTargets,
} from "./previewLoader";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { GalleryCardMedia } from "@/features/gallery/components/GalleryCardMedia";

const visibleZones: galleryScrollRoot.GalleryMediaZones = {
  shouldLoad: true,
  shouldKeep: true,
  priority: "visible",
};

function makeItem(name: string): GalleryItem {
  return {
    name,
    path: `${HOME_PATH}\\${name}`,
    modified_at: "2026-01-01T00:00:00Z",
    size: 100,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    caption_status: "none",
    media_type: "image",
  };
}

describe("previewLoader integration", () => {
  afterEach(() => {
    resetGalleryPreviewLoaderForTests();
    vi.restoreAllMocks();
  });

  it("aborts stale visible in-flight loads when the viewport sync moves on", () => {
    const originalImage = globalThis.Image;
    const startedPaths: string[] = [];

    class MockImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        const path = decodeURIComponent(value.split("path=")[1]?.split("&")[0] ?? value);
        startedPaths.push(path);
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;

    syncGalleryPreviewTargets([
      {
        path: `${HOME_PATH}\\old.png`,
        url: `/api/thumbnail?path=${HOME_PATH}\\old.png`,
        priority: "visible",
      },
    ]);

    syncGalleryPreviewTargets([
      {
        path: `${HOME_PATH}\\new.png`,
        url: `/api/thumbnail?path=${HOME_PATH}\\new.png`,
        priority: "visible",
      },
    ]);

    const state = getGalleryPreviewLoaderStateForTests();
    expect(state.inflightCount).toBe(1);
    expect(startedPaths.at(-1)).toContain("new.png");
    globalThis.Image = originalImage;
  });

  it("limits concurrent loads while scrolling is active", () => {
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

    const targets = Array.from({ length: 12 }, (_, index) => ({
      path: `${HOME_PATH}\\item-${index}.png`,
      url: `/api/thumbnail?path=${HOME_PATH}\\item-${index}.png`,
      priority: "visible" as const,
    }));

    syncGalleryPreviewTargets(targets);

    expect(getGalleryPreviewLoaderStateForTests().inflightCount).toBeLessThanOrEqual(8);
    globalThis.Image = originalImage;
  });

  it("does not assign img src until the preview loader has warmed the cache", async () => {
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
    vi.spyOn(galleryScrollRoot, "getGalleryMediaZones").mockReturnValue(visibleZones);

    const { container } = render(
      <main>
        <GalleryCardMedia item={makeItem("sunset.png")} />
      </main>,
    );

    const image = container.querySelector("img.card__img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBeNull();

    await actFinishPreviewLoad(finishLoad);

    await waitFor(() => {
      expect(container.querySelector('img[src*="/api/thumbnail"]')).not.toBeNull();
    });

    globalThis.Image = originalImage;
  });
});

async function actFinishPreviewLoad(finishLoad: (() => void) | undefined): Promise<void> {
  await waitFor(() => {
    expect(finishLoad).toBeDefined();
  });
  finishLoad?.();
  await Promise.resolve();
}
