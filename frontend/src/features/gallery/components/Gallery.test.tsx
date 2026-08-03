import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as captionStatus from "@/features/gallery/lib/captionStatus";
import * as scrollRoot from "@/features/gallery/lib/scrollRoot";
import { HOME_PATH } from "@/test/fixtures";
import { withGallerySelection } from "@/test/gallerySelection";
import type { GalleryItem } from "@/shared/types";
import { Gallery } from "./Gallery";

// GalleryCard calls this once per render, so it doubles as a render counter.
vi.mock("@/features/gallery/lib/captionStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof captionStatus>();
  return { ...actual, getCardCaptionDisplay: vi.fn(actual.getCardCaptionDisplay) };
});

const cardRenderSpy = vi.mocked(captionStatus.getCardCaptionDisplay);

const imageItem: GalleryItem = {
  name: "sunset.png",
  path: `${HOME_PATH}\\sunset.png`,
  description: "Golden hour",
  has_description: true,
  has_caption_file: true,
  issue_fixes: [],
  has_issue_file: false,
  caption_status: "text",
  caption_file_type: "txt",
  media_type: "image",
  width: 1920,
  height: 1080,
};

const videoItem: GalleryItem = {
  name: "clip.mp4",
  path: `${HOME_PATH}\\clip.mp4`,
  description: null,
  has_description: false,
  has_caption_file: false,
  issue_fixes: [],
  has_issue_file: false,
  caption_status: "none",
  caption_file_type: null,
  media_type: "video",
};

describe("Gallery", () => {
  it("mounts image previews and video placeholders for visible virtual rows", () => {
    const { container } = render(
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} />
        </main>,
      ),
    );

    expect(container.querySelectorAll("img.card__img")).toHaveLength(2);
    expect(container.querySelector("video.card__video")).toBeNull();
  });

  it("toggles selection in selection mode instead of opening the item", () => {
    const onSelect = vi.fn();
    const toggleSelectedPath = vi.fn();

    render(
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={onSelect} />
        </main>,
        {
          selectionMode: true,
          selectedPaths: new Set([imageItem.path]),
          toggleSelectedPath,
        },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: `Deselect ${imageItem.name}` }));
    expect(toggleSelectedPath).toHaveBeenCalledWith(imageItem.path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("re-renders only the card whose selection changed", () => {
    // Stable across renders, matching the memoized `openGalleryItem` in the app.
    const onSelect = vi.fn();
    const gallery = (selectedPaths: ReadonlySet<string>) =>
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={onSelect} />
        </main>,
        { selectionMode: true, selectedPaths },
      );

    const { rerender } = render(gallery(new Set()));
    cardRenderSpy.mockClear();

    // Selecting one item must not re-render the other card, or large folders
    // would repaint the whole visible grid on every click.
    rerender(gallery(new Set([imageItem.path])));

    expect(cardRenderSpy.mock.calls.map(([item]) => item.path)).toEqual([imageItem.path]);
  });

  it("shows a back-to-top button after scrolling the main container", () => {
    vi.spyOn(scrollRoot, "scrollContainerToTop").mockImplementation((element) => {
      element.scrollTop = 0;
      return () => {};
    });

    const { container } = render(
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} />
        </main>,
      ),
    );

    const main = container.querySelector("main.main");
    if (!(main instanceof HTMLElement)) {
      throw new Error("Expected main scroll container");
    }

    Object.defineProperty(main, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    const button = screen.getByRole("button", { name: "Back to top" });
    expect(button).not.toHaveClass("gallery-back-to-top--visible");

    Object.defineProperty(main, "scrollTop", {
      value: 500,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(main);

    expect(button).toHaveClass("gallery-back-to-top--visible");

    fireEvent.click(button);

    expect(main.scrollTop).toBe(0);
  });
});
