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
  has_duplicate_file: false,
  has_backup: false,
  has_candidate: false,
  caption_status: "text",
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
  media_type: "video",
};

describe("GalleryListRow", () => {
  it("shows the caption state as an icon instead of the caption text", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    // A caption paragraph would swamp a single-line row, and so would the word
    // for its state - the label survives as the tooltip.
    expect(screen.queryByText("Golden hour over the harbour")).toBeNull();
    expect(screen.queryByText("Captioned")).toBeNull();

    const status = container.querySelector(".gallery-list-row__status");
    expect(status).toHaveAttribute("title", "Captioned");
    expect(status?.querySelector(".gallery-list-row__status-icon")).toBeInTheDocument();
  });

  it("gives each caption state its own icon and tooltip", () => {
    const statusOf = (item: GalleryItem) => {
      const { container } = render(<GalleryListRow item={item} onSelect={vi.fn()} />);
      const status = container.querySelector(".gallery-list-row__status");
      return {
        title: status?.getAttribute("title"),
        variant: [...(status?.classList ?? [])].find((name) => name.includes("--")),
        // The drawn shape, which is what actually distinguishes one icon from another.
        icon: status?.querySelector("svg")?.innerHTML,
      };
    };

    const captioned = statusOf(captionedItem);
    const empty = statusOf({ ...uncaptionedVideo, caption_status: "empty" });
    const missing = statusOf(uncaptionedVideo);

    expect([captioned.title, empty.title, missing.title]).toEqual([
      "Captioned",
      "Empty",
      "No caption",
    ]);
    expect([captioned.variant, empty.variant, missing.variant]).toEqual([
      "gallery-list-row__status--success",
      "gallery-list-row__status--warning",
      "gallery-list-row__status--muted",
    ]);
    // Three states, three different icons.
    expect(new Set([captioned.icon, empty.icon, missing.icon]).size).toBe(3);
  });

  it("shows megapixels, size, and modified date", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    // Resolution is one number per row, not a w × h pair to compare down the column.
    expect(container.querySelector(".gallery-list-row__meta-item--megapixels")?.textContent).toBe(
      "2.1 MP",
    );
    expect(container.querySelector(".gallery-list-row__meta-item--size")?.textContent).toBe(
      "2.4 MB",
    );
    expect(container.querySelector(".gallery-list-row__meta-item--modified")?.textContent).not.toBe(
      "",
    );
  });

  it("keeps an empty column for a file fact the media item does not carry", () => {
    const { container } = render(
      <GalleryListRow
        item={{ ...captionedItem, width: null, height: null, size: null, modified_at: null }}
        onSelect={vi.fn()}
      />,
    );

    // Dropping the cells would slide every later column out of the list's table.
    const cells = [...container.querySelectorAll(".gallery-list-row__meta-item")];
    expect(cells).toHaveLength(4);
    expect(cells.map((cell) => cell.textContent)).toEqual(["", "", "", ""]);
  });

  it("shows a video's length in seconds", () => {
    const { container } = render(
      <GalleryListRow item={{ ...uncaptionedVideo, duration: 5.4 }} onSelect={vi.fn()} />,
    );

    expect(container.querySelector(".gallery-list-row__meta-item--duration")?.textContent).toBe(
      "5 s",
    );
  });

  it("keeps the marker column for an item with no markers", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    const markers = container.querySelector(".gallery-list-row__markers");
    expect(markers).toBeInTheDocument();
    expect(markers?.children).toHaveLength(0);
  });

  it("reduces badges to icon markers that keep their label as a tooltip", () => {
    const { container } = render(
      <GalleryListRow
        item={{ ...uncaptionedVideo, has_issue_file: true, has_duplicate_file: true }}
        onSelect={vi.fn()}
      />,
    );

    const markers = [...container.querySelectorAll(".gallery-list-row__marker")];
    expect(markers.map((marker) => marker.getAttribute("title"))).toEqual([
      "Video",
      "Caption issue",
      "Duplicate",
    ]);
  });

  it("marks a candidate", () => {
    const { container } = render(
      <GalleryListRow item={{ ...captionedItem, has_candidate: true }} onSelect={vi.fn()} />,
    );

    const markers = [...container.querySelectorAll(".gallery-list-row__marker")];
    expect(markers.map((marker) => marker.getAttribute("title"))).toEqual(["Candidate"]);
    expect(markers[0]).toHaveClass("gallery-list-row__marker--candidate");
  });

  it("marks an edited file so a stored original is visible without opening it", () => {
    const { container } = render(
      <GalleryListRow item={{ ...captionedItem, has_backup: true }} onSelect={vi.fn()} />,
    );

    const markers = [...container.querySelectorAll(".gallery-list-row__marker")];
    expect(markers.map((marker) => marker.getAttribute("title"))).toEqual(["Edited"]);
    expect(markers[0]).toHaveClass("gallery-list-row__marker--edited");
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
    // The checkbox leads the row, ahead of the thumbnail, and the modifier is
    // what opens the column for it.
    expect(row).toHaveClass("gallery-list-row--selecting");
    expect(row?.firstElementChild).toHaveClass("gallery-list-row__check");

    fireEvent.click(screen.getByRole("button", { name: `Select ${captionedItem.name}` }));
    expect(onToggleSelect).toHaveBeenCalledWith(captionedItem.path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("hides the checkbox outside selection mode", () => {
    const { container } = render(<GalleryListRow item={captionedItem} onSelect={vi.fn()} />);

    const row = container.querySelector(".gallery-list-row");
    expect(container.querySelector(".gallery-list-row__check")).toBeNull();
    expect(row).not.toHaveClass("gallery-list-row--selecting");
    expect(row?.firstElementChild).toHaveClass("gallery-list-row__thumb");
  });

  it("selects on Ctrl+click without opening the item", () => {
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <GalleryListRow
        item={captionedItem}
        onSelect={onSelect}
        onToggleSelect={onToggleSelect}
        onExtendSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: `View ${captionedItem.name}` }), {
      ctrlKey: true,
    });

    expect(onToggleSelect).toHaveBeenCalledWith(captionedItem.path);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("extends the selection on Shift+click", () => {
    const onSelect = vi.fn();
    const onToggleSelect = vi.fn();
    const onExtendSelect = vi.fn();
    render(
      <GalleryListRow
        item={captionedItem}
        onSelect={onSelect}
        onToggleSelect={onToggleSelect}
        onExtendSelect={onExtendSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: `View ${captionedItem.name}` }), {
      shiftKey: true,
    });

    expect(onExtendSelect).toHaveBeenCalledWith(captionedItem.path);
    expect(onToggleSelect).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // A row rendered without the handler predates the gesture; it must still open.
  it("falls back to opening when no selection handler is wired", () => {
    const onSelect = vi.fn();
    render(<GalleryListRow item={captionedItem} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: `View ${captionedItem.name}` }), {
      ctrlKey: true,
    });

    expect(onSelect).toHaveBeenCalledWith(captionedItem.path);
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
