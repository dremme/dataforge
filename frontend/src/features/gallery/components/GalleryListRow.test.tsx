import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { GalleryListRow } from "./GalleryListRow";

const captionedItem: GalleryItem = {
  name: "sunset.png",
  path: `${HOME_PATH}\\sunset.png`,
  description: "Golden hour over the harbour",
  has_description: true,
  has_caption_file: true,
  issue_fixes: [],
  has_issue_file: false,
  caption_status: "text",
  caption_file_type: "txt",
  media_type: "image",
  width: 1920,
  height: 1080,
  size: 2_516_582,
  modified_at: "2026-06-19T12:00:00.000Z",
};

const uncaptionedVideo: GalleryItem = {
  ...captionedItem,
  name: "clip.mp4",
  path: `${HOME_PATH}\\clip.mp4`,
  description: null,
  has_description: false,
  has_caption_file: false,
  caption_status: "none",
  caption_file_type: null,
  media_type: "video",
};

describe("GalleryListRow", () => {
  it("shows a terse status instead of the caption text", () => {
    render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    // A caption paragraph would swamp a single-line row.
    expect(screen.queryByText("Golden hour over the harbour")).toBeNull();
    expect(screen.getByText("Captioned")).toBeInTheDocument();
  });

  it("shortens the missing- and empty-caption states to fit one line", () => {
    const { rerender } = render(<GalleryListRow item={uncaptionedVideo} onSelect={vi.fn()} />);
    expect(screen.getByText("No caption")).toBeInTheDocument();

    rerender(
      <GalleryListRow item={{ ...uncaptionedVideo, caption_status: "empty" }} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("shows dimensions, size, and modified date", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    const meta = container.querySelector(".gallery-list-row__meta");
    // Dimensions go through toLocaleString, so the separator follows the locale.
    expect(meta?.textContent).toContain(`${(1920).toLocaleString()} × ${(1080).toLocaleString()}`);
    expect(meta?.textContent).toContain("2.4 MB");
    expect(container.querySelectorAll(".gallery-list-row__meta-item")).toHaveLength(3);
  });

  it("omits the file facts a media item does not carry", () => {
    const { container } = render(
      <GalleryListRow
        item={{ ...captionedItem, width: null, height: null, size: null, modified_at: null }}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".gallery-list-row__meta")).toBeNull();
  });

  it("reduces badges to icon markers that keep their label as a tooltip", () => {
    const { container } = render(
      <GalleryListRow
        item={{ ...uncaptionedVideo, has_issue_file: true, caption_file_type: "json" }}
        onSelect={vi.fn()}
      />,
    );

    const markers = [...container.querySelectorAll(".gallery-list-row__marker")];
    expect(markers.map((marker) => marker.getAttribute("title"))).toEqual([
      "Video",
      "Caption issue",
      "JSON caption",
    ]);
  });

  it("opens the item when not selecting", () => {
    const onSelect = vi.fn();
    render(<GalleryListRow item={captionedItem} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: `View ${captionedItem.name}` }));
    expect(onSelect).toHaveBeenCalledWith(captionedItem.path);
  });

  it("shows a leading checkbox and toggles instead of opening in selection mode", () => {
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();
    const { container } = render(
      <GalleryListRow
        item={captionedItem}
        onSelect={onSelect}
        selectionMode
        onToggleSelect={onToggleSelect}
      />,
    );

    const row = container.querySelector(".gallery-list-row");
    // The checkbox leads the row, ahead of the thumbnail.
    expect(row?.firstElementChild).toHaveClass("gallery-list-row__check");

    fireEvent.click(screen.getByRole("button", { name: `Select ${captionedItem.name}` }));
    expect(onToggleSelect).toHaveBeenCalledWith(captionedItem.path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides the checkbox outside selection mode", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    expect(container.querySelector(".gallery-list-row__check")).toBeNull();
    expect(container.querySelector(".gallery-list-row")?.firstElementChild).toHaveClass(
      "gallery-list-row__thumb",
    );
  });

  it("marks a selected row for assistive tech and styling", () => {
    const { container } = render(
      <GalleryListRow item={captionedItem} onSelect={vi.fn()} selectionMode selected />,
    );

    const row = screen.getByRole("button", { name: `Deselect ${captionedItem.name}` });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".gallery-list-row--selected")).toBeInTheDocument();
  });
});
