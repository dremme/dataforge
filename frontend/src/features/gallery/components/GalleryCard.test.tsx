import { renderWithThumbnails as render } from "@/test/renderWithThumbnails";
import { StrictMode } from "react";
import { act, createEvent, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
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
  rule_findings: [],
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

  it("clamps the caption to the configured line count", () => {
    render(<GalleryCard item={captionedItem} onSelect={vi.fn()} captionLines={6} />);

    expect(
      screen
        .getByText("Golden hour over the harbour")
        .style.getPropertyValue("--card-caption-lines"),
    ).toBe("6");
  });

  it("hides the caption when its line count is off, without a status pill", () => {
    const { container } = render(
      <GalleryCard item={captionedItem} onSelect={vi.fn()} captionLines={0} />,
    );

    expect(screen.queryByText("Golden hour over the harbour")).toBeNull();
    expect(container.querySelector(".card__caption-status")).toBeNull();
  });

  it("hides the status pill too when captions are off, keeping the seam", () => {
    const empty = { ...uncaptionedItem, has_caption_file: true, caption_status: "empty" as const };
    const { container, rerender } = render(
      <GalleryCard item={uncaptionedItem} onSelect={vi.fn()} captionLines={0} />,
    );

    expect(container.querySelector(".card__caption-status")).toBeNull();

    rerender(<GalleryCard item={empty} onSelect={vi.fn()} captionLines={0} />);
    expect(container.querySelector(".card__caption-status")).toBeNull();
    expect(container.querySelector(".card")).toHaveClass("card--partial");
  });

  it("keeps the badges over the media when captions are off", () => {
    const item = {
      ...uncaptionedItem,
      has_issue_file: true,
      has_candidate: true,
      has_duplicate_file: true,
    };
    const { container } = render(<GalleryCard item={item} onSelect={vi.fn()} captionLines={0} />);

    const media = container.querySelector(".card__media");
    expect(media?.querySelector(".card__badge--video")).toBeInTheDocument();
    expect(media?.querySelector(".card__badge--issue")).toBeInTheDocument();
    expect(media?.querySelector(".card__badge--candidate")).toBeInTheDocument();
    expect(media?.querySelector(".card__badge--duplicate")).toBeInTheDocument();
  });

  it("adds the aspect ratio beside the megapixels when asked", () => {
    const { container } = render(
      <GalleryCard item={captionedItem} onSelect={vi.fn()} showAspectRatio />,
    );

    expect(container.querySelector(".card__meta")).toHaveTextContent("2.1 MP · 16:9");
  });

  it("hides the megapixels when asked, keeping the aspect ratio", () => {
    const { container, rerender } = render(
      <GalleryCard item={captionedItem} onSelect={vi.fn()} showMegapixels={false} />,
    );

    expect(container.querySelector(".card__meta")).toBeNull();

    rerender(
      <GalleryCard
        item={captionedItem}
        onSelect={vi.fn()}
        showMegapixels={false}
        showAspectRatio
      />,
    );
    expect(container.querySelector(".card__meta")).toHaveTextContent(/^16:9$/);
  });

  it("never starts a native drag of the card", () => {
    render(<GalleryCard item={captionedItem} onSelect={vi.fn()} />);

    expect(fireEvent.dragStart(screen.getByRole("button", { name: "View sunset.png" }))).toBe(
      false,
    );
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

  it("stacks the issue and candidate badges in one column, issue first", () => {
    const { container } = render(
      <GalleryCard
        item={{ ...captionedItem, has_issue_file: true, has_candidate: true }}
        onSelect={vi.fn()}
      />,
    );

    const stack = container.querySelector(".card__badge-stack");
    expect(stack).toBeInTheDocument();
    expect(
      Array.from(stack!.children, (badge) => badge.classList.contains("card__badge--issue")),
    ).toEqual([true, false]);
    expect(stack?.lastElementChild).toHaveClass("card__badge--candidate");
  });

  it.each([
    ["issue", { has_issue_file: true }],
    ["candidate", { has_candidate: true }],
  ])("keeps a lone %s badge in the stack corner", (variant, flags) => {
    const { container } = render(
      <GalleryCard item={{ ...captionedItem, ...flags }} onSelect={vi.fn()} />,
    );

    const stack = container.querySelector(".card__badge-stack");
    expect(stack?.children).toHaveLength(1);
    expect(stack?.firstElementChild).toHaveClass(`card__badge--${variant}`);
  });

  it("stacks the duplicate badge last, with the other findings", () => {
    const { container } = render(
      <GalleryCard
        item={{ ...captionedItem, has_issue_file: true, has_duplicate_file: true }}
        onSelect={vi.fn()}
      />,
    );

    const stack = container.querySelector(".card__badge-stack");
    expect(stack?.children).toHaveLength(2);
    expect(stack?.lastElementChild).toHaveClass("card__badge--duplicate");
  });

  it("labels a video badge with the clip length when it is known", () => {
    const { container, rerender } = render(
      <GalleryCard item={{ ...uncaptionedItem, duration: 12.4 }} onSelect={vi.fn()} />,
    );

    expect(container.querySelector(".card__badge--video")).toHaveTextContent("12 s");

    rerender(<GalleryCard item={{ ...uncaptionedItem, duration: null }} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__badge--video")).toHaveTextContent("Video");
  });

  it("badges audio with its length, and never as a video", () => {
    const audio: GalleryItem = {
      ...uncaptionedItem,
      name: "voice.wav",
      path: `${HOME_PATH}\\voice.wav`,
      media_type: "audio",
      width: null,
      height: null,
      duration: 75,
    };
    const { container, rerender } = render(<GalleryCard item={audio} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__badge--audio")).toHaveTextContent("1:15");
    expect(container.querySelector(".card__badge--video")).toBeNull();
    expect(container.querySelector(".card")).not.toHaveClass("card--video");

    rerender(<GalleryCard item={{ ...audio, duration: null }} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__badge--audio")).toHaveTextContent("Audio");
  });

  it("shows the megapixel count beside the title on large and small cards", () => {
    const { container, rerender } = render(<GalleryCard item={captionedItem} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__title")).toHaveTextContent(/^sunset\.png$/);
    expect(container.querySelector(".card__meta")).toHaveTextContent("2.1 MP");

    rerender(<GalleryCard item={captionedItem} onSelect={vi.fn()} displayMode="small" />);
    expect(container.querySelector(".card__meta")).toHaveTextContent("2.1 MP");

    rerender(<GalleryCard item={{ ...captionedItem, width: null }} onSelect={vi.fn()} />);
    expect(container.querySelector(".card__meta")).toBeNull();
  });

  it("renders no stack when neither badge applies", () => {
    const { container } = render(<GalleryCard item={captionedItem} onSelect={vi.fn()} />);

    expect(container.querySelector(".card__badge-stack")).toBeNull();
  });

  it("shrinks badges to their icon on small cards", () => {
    const { container } = render(
      <GalleryCard
        item={{ ...captionedItem, has_candidate: true }}
        onSelect={vi.fn()}
        displayMode="small"
      />,
    );

    const badge = container.querySelector(".card__badge--candidate");
    expect(badge).toHaveClass("card__badge--compact");
    expect(badge?.textContent).toBe("");
    expect(badge?.querySelector(".card__badge-icon")).toBeInTheDocument();
  });

  describe("hover preview", () => {
    let play: Mock<() => Promise<void>>;
    let pause: Mock<() => void>;

    beforeEach(() => {
      vi.useFakeTimers();
      play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      pause = vi.fn<() => void>();
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

    it("plays the preview at double speed, surviving the load that resets the rate", () => {
      const { container } = render(<GalleryCard item={uncaptionedItem} onSelect={vi.fn()} />);

      hover(screen.getByRole("button"));
      act(() => vi.advanceTimersByTime(400));

      const video = preview(container)!;
      expect(video.defaultPlaybackRate).toBe(2);
      expect(video.playbackRate).toBe(2);
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

  describe("name tooltip", () => {
    const longName = "a file name long enough to be truncated on its card.png";

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows the full file name after the usual tooltip delay", () => {
      render(<GalleryCard item={{ ...captionedItem, name: longName }} onSelect={vi.fn()} />);

      fireEvent.mouseEnter(screen.getByRole("button", { name: `View ${longName}` }));
      act(() => vi.advanceTimersByTime(399));
      expect(screen.queryByRole("tooltip")).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("tooltip")).toHaveTextContent(longName);
    });

    it("shows the name to keyboard users too, in place of the native title", () => {
      const { container } = render(
        <GalleryCard item={{ ...captionedItem, name: longName }} onSelect={vi.fn()} />,
      );

      act(() => screen.getByRole("button", { name: `View ${longName}` }).focus());
      act(() => vi.advanceTimersByTime(400));

      expect(screen.getByRole("tooltip")).toHaveTextContent(longName);
      expect(container.querySelector("[title]")).toBeNull();
    });
  });
});
