import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { GalleryCard } from "./GalleryCard";

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

const uncaptionedItem: GalleryItem = {
  ...captionedItem,
  name: "clip.mp4",
  path: `${HOME_PATH}\\clip.mp4`,
  description: null,
  has_description: false,
  has_caption_file: false,
  caption_status: "none",
  media_type: "video",
};

describe("GalleryCard", () => {
  it("shows the caption text", () => {
    render(<GalleryCard item={captionedItem} onSelect={vi.fn()} />);

    expect(screen.getByText("Golden hour over the harbour")).toBeInTheDocument();
  });

  it("falls back to the caption status when there is no caption", () => {
    render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

    expect(screen.getByText("No caption file found")).toBeInTheDocument();
  });

  it("carries the display mode as a modifier so small cards can tighten", () => {
    const { container } = render(
      <GalleryCard item={captionedItem} onSelect={vi.fn()} displayMode="small" />,
    );

    expect(container.querySelector(".card--small")).toBeInTheDocument();
  });

  it("pins badges over the thumbnail", () => {
    const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__media .card__badge")).toBeInTheDocument();
  });

  it("badges a file that has a candidate", () => {
    const { container } = render(
      <GalleryCard item={{ ...captionedItem, has_candidate: true }} onSelect={vi.fn()} />,
    );

    const badge = container.querySelector(".card__badge--candidate");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Candidate");
  });
});
