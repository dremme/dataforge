import { renderWithThumbnails as render } from "@/test/renderWithThumbnails";
import { describe, expect, it, vi } from "vitest";
import { galleryLayoutFor } from "@/features/gallery/lib/layout";
import type { GalleryItem } from "@/shared/types";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { withGallerySelection } from "@/test/gallerySelection";
import { GalleryUniformGrid } from "./GalleryUniformGrid";

// The suite-wide mock skips the sizing callbacks this file exists to check.
vi.unmock("@tanstack/react-virtual");

/** The height the grid reserves before any row is measured. */
function reservedHeight(items: GalleryItem[]): string | undefined {
  const { container } = render(
    withGallerySelection(
      <GalleryUniformGrid items={items} onSelect={vi.fn()} displayMode="small" />,
    ),
  );
  return container.querySelector<HTMLElement>(".gallery-virtual__inner")?.style.height;
}

describe("GalleryUniformGrid", () => {
  const { rowEstimate, captionRowEstimate } = galleryLayoutFor("small");

  it("reserves the taller estimate for a row with a caption", () => {
    const captioned = mediaItem("sunset.png", HOME_PATH, { description: "Golden hour" });

    expect(reservedHeight([captioned])).toBe(`${captionRowEstimate}px`);
  });

  it("reserves the plain estimate for a row without one", () => {
    const plain = mediaItem("beach.jpg", HOME_PATH, { description: null });

    expect(reservedHeight([plain])).toBe(`${rowEstimate}px`);
  });
});
