import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as scrollRoot from "@/features/gallery/lib/scrollRoot";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { Gallery } from "./Gallery";

const imageItem: GalleryItem = {
  name: "sunset.png",
  path: `${HOME_PATH}\\sunset.png`,
  description: "Golden hour",
  has_description: true,
  has_caption_file: true,
  issue: null,
  issue_suggestions: null,
  has_issue_file: false,
  has_bboxes: false,
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
  issue: null,
  issue_suggestions: null,
  has_issue_file: false,
  has_bboxes: false,
  caption_status: "none",
  caption_file_type: null,
  media_type: "video",
};

describe("Gallery", () => {
  it("mounts image previews and video placeholders for visible virtual rows", () => {
    const { container } = render(
      <main className="main">
        <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} />
      </main>,
    );

    expect(container.querySelectorAll("img.card__img")).toHaveLength(2);
    expect(container.querySelector("video.card__video")).toBeNull();
  });

  it("toggles selection in selection mode instead of opening the item", () => {
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();

    render(
      <main className="main">
        <Gallery
          items={[imageItem, videoItem]}
          onSelect={onSelect}
          selectionMode
          selectedPaths={new Set([imageItem.path])}
          onToggleSelect={onToggleSelect}
        />
      </main>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Deselect ${imageItem.name}` }));
    expect(onToggleSelect).toHaveBeenCalledWith(imageItem.path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a back-to-top button after scrolling the main container", () => {
    vi.spyOn(scrollRoot, "scrollContainerToTop").mockImplementation((element) => {
      element.scrollTop = 0;
      return () => {};
    });

    const { container } = render(
      <main className="main">
        <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} />
      </main>,
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
