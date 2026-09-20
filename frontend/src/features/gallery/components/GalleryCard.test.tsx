import { StrictMode } from "react";
import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
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

  describe("hover preview", () => {
    let play: ReturnType<typeof vi.fn>;
    let pause: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    // jsdom has no PointerEvent, so pointerType would be dropped from the init dict.
    const hover = (card: HTMLElement, pointerType = "mouse") => {
      const event = createEvent.pointerOver(card);
      Object.defineProperty(event, "pointerType", { value: pointerType });
      fireEvent(card, event);
    };
    const preview = (container: HTMLElement) =>
      container.querySelector<HTMLVideoElement>("video.card__video-preview");

    it("mounts a muted preview only after the pointer rests for 400 ms", () => {
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

      hover(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(399));
      expect(preview(container)).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      const video = preview(container);
      expect(video).not.toBeNull();
      expect(video?.getAttribute("src")).toBe(galleryItemMediaUrl(uncaptionedItem));
      expect(video?.muted).toBe(true);
      expect(play).toHaveBeenCalled();
    });

    // StrictMode replays the effect; its cleanup strips src, which a JSX prop never restores.
    it("keeps the preview source through an effect replay", () => {
      const { container } = render(
        <StrictMode>
          <GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />
        </StrictMode>,
      );

      hover(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(400));

      expect(preview(container)?.getAttribute("src")).toBe(galleryItemMediaUrl(uncaptionedItem));
    });

    it("never mounts when the pointer leaves before the delay", () => {
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);
      const card = screen.getByRole("button");

      hover(card);
      act(() => vi.advanceTimersByTime(300));
      fireEvent.pointerLeave(card);
      act(() => vi.advanceTimersByTime(1000));

      expect(preview(container)).toBeNull();
    });

    it("tears the preview down and aborts its download on leave", () => {
      const load = vi.spyOn(HTMLMediaElement.prototype, "load");
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);
      const card = screen.getByRole("button");

      hover(card);
      act(() => vi.advanceTimersByTime(400));
      expect(preview(container)).not.toBeNull();

      fireEvent.pointerLeave(card);
      expect(preview(container)).toBeNull();
      expect(pause).toHaveBeenCalled();
      expect(load).toHaveBeenCalled();
    });

    it("hides the overlay once the preview is actually playing", () => {
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

      hover(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(400));
      expect(container.querySelector(".card--previewing")).toBeNull();

      fireEvent.playing(preview(container)!);
      expect(container.querySelector(".card--previewing")).not.toBeNull();
    });

    it.each([
      [
        "a matroska video",
        { ...uncaptionedItem, name: "clip.mkv", path: `${HOME_PATH}\\clip.mkv` },
      ],
      ["an image", captionedItem],
      ["a GIF", { ...captionedItem, name: "loop.gif", media_type: "gif" as const }],
    ])("never previews %s", (_label, item) => {
      const { container } = render(<GalleryCard item={item} onSelect={vi.fn()} />);

      hover(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(1000));

      expect(container.querySelector("video")).toBeNull();
    });

    it("ignores touch so a tap never starts a download", () => {
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

      hover(screen.getByRole("button"), "touch");
      act(() => vi.advanceTimersByTime(1000));

      expect(preview(container)).toBeNull();
    });
  });
});
