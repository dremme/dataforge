import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as captionStatus from "@/features/gallery/lib/captionStatus";
import * as scrollRoot from "@/features/gallery/lib/scrollRoot";
import { galleryLayoutFor } from "@/features/gallery/lib/layout";
import {
  CARD_BORDER_PX,
  galleryColumnWidth,
  largeCardHeight,
} from "@/features/gallery/lib/cardGeometry";
import { HOME_PATH } from "@/test/fixtures";
import { withGallerySelection } from "@/test/gallerySelection";
import type { GalleryItem } from "@/shared/types";
import { Gallery } from "./Gallery";

// Not getCardCaptionDisplay: masonry reads that too, so it would count layout passes.
vi.mock("@/features/gallery/lib/captionStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof captionStatus>();
  return { ...actual, getCardModifierClass: vi.fn(actual.getCardModifierClass) };
});

const cardRenderSpy = vi.mocked(captionStatus.getCardModifierClass);

const imageItem: GalleryItem = {
  name: "sunset.png",
  path: `${HOME_PATH}\\sunset.png`,
  description: "Golden hour",
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
};

const videoItem: GalleryItem = {
  name: "clip.mp4",
  path: `${HOME_PATH}\\clip.mp4`,
  description: null,
  has_description: false,
  has_caption_file: false,
  issue_fixes: [],
  has_issue_file: false,
  has_duplicate_file: false,
  has_backup: false,
  has_candidate: false,
  caption_status: "none",
  media_type: "video",
};

const LARGE_ITEMS: GalleryItem[] = [
  { ...imageItem, name: "alpha.png", path: `${HOME_PATH}\\alpha.png`, width: 1600, height: 900 },
  { ...imageItem, name: "bravo.png", path: `${HOME_PATH}\\bravo.png`, width: 900, height: 1600 },
  {
    ...imageItem,
    name: "charlie.png",
    path: `${HOME_PATH}\\charlie.png`,
    width: 1200,
    height: 1200,
  },
  { ...imageItem, name: "delta.png", path: `${HOME_PATH}\\delta.png`, width: 1600, height: 900 },
];

/** Shadows test/setup.ts clientWidth. clientHeight stays 0, so masonry overscan is ~1920px. */
function stubClientWidth(width: number): void {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return width;
    },
  });
}

function captureResizeObservers() {
  const callbacks: ResizeObserverCallback[] = [];
  const original = window.ResizeObserver;

  class CapturingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  window.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;

  return {
    fire: () => {
      for (const callback of [...callbacks]) callback([], {} as ResizeObserver);
    },
    restore: () => {
      window.ResizeObserver = original;
    },
  };
}

function expectMasonryGeometry(container: HTMLElement, items: GalleryItem[], width: number): void {
  const layout = galleryLayoutFor("large");
  const minColumnWidth = layout.minColumnWidth ?? 0;
  const columnCount = Math.max(1, Math.floor((width + layout.gap) / (minColumnWidth + layout.gap)));
  const columnWidth = galleryColumnWidth(width, columnCount, layout.gap);
  const cells = [...container.querySelectorAll(".gallery-masonry-item")] as HTMLElement[];

  expect(cells.map((cell) => cell.querySelector(".card__title")?.textContent)).toEqual(
    items.map((item) => item.name),
  );

  const laneTops = Array.from({ length: columnCount }, () => 0);

  items.forEach((item, index) => {
    const cell = cells[index];
    const lane = index % columnCount;
    const height = largeCardHeight(item, columnWidth);

    expect(cell.dataset.lane).toBe(String(lane));
    expect(Number.parseFloat(cell.style.left)).toBeCloseTo(lane * (columnWidth + layout.gap));
    expect(Number.parseFloat(cell.style.top)).toBeCloseTo(laneTops[lane]);
    expect(Number.parseFloat(cell.style.width)).toBeCloseTo(columnWidth);
    expect(Number.parseFloat(cell.style.height)).toBeCloseTo(height);

    const media = Number.parseFloat(cell.style.getPropertyValue("--card-media-h"));
    const body = Number.parseFloat(cell.style.getPropertyValue("--card-body-h"));
    expect(2 * CARD_BORDER_PX + media + body).toBeCloseTo(height);

    laneTops[lane] = laneTops[lane] + height + layout.gap;
  });
}

describe("Gallery", () => {
  // Large mode lays out from the container's measured width, and jsdom measures
  // everything as zero, so every test needs a width to render anything at all.
  let clientWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    clientWidth = Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, "clientWidth");
    stubClientWidth(1000);
  });

  afterEach(() => {
    if (clientWidth) {
      Object.defineProperty(HTMLDivElement.prototype, "clientWidth", clientWidth);
    }
  });

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

  it("packs large cards into sorted columns without row-height gaps", () => {
    const { container } = render(
      withGallerySelection(
        <main className="main">
          <Gallery items={LARGE_ITEMS} onSelect={vi.fn()} displayMode="large" />
        </main>,
      ),
    );

    expectMasonryGeometry(container, LARGE_ITEMS, 1000);

    // Three lanes, so the fourth card sits under the first rather than under the
    // tall portrait beside it.
    const cells = [...container.querySelectorAll(".gallery-masonry-item")] as HTMLElement[];
    expect(cells.map((cell) => cell.dataset.lane)).toEqual(["0", "1", "2", "0"]);
    expect(Number.parseFloat(cells[3].style.top)).toBeLessThan(
      largeCardHeight(LARGE_ITEMS[1], galleryColumnWidth(1000, 3, galleryLayoutFor("large").gap)),
    );
  });

  it("re-lays out large cards from the new column width when the gallery resizes", () => {
    const observers = captureResizeObservers();

    try {
      const { container } = render(
        withGallerySelection(
          <main className="main">
            <Gallery items={LARGE_ITEMS} onSelect={vi.fn()} displayMode="large" />
          </main>,
        ),
      );

      expectMasonryGeometry(container, LARGE_ITEMS, 1000);

      // Narrow enough to drop a column: nothing may survive from the old width.
      stubClientWidth(640);
      act(() => observers.fire());

      expectMasonryGeometry(container, LARGE_ITEMS, 640);

      const cells = [...container.querySelectorAll(".gallery-masonry-item")] as HTMLElement[];
      expect(cells.map((cell) => cell.dataset.lane)).toEqual(["0", "1", "0", "1"]);
    } finally {
      observers.restore();
    }
  });

  it("keeps small mode on equal-width columns", () => {
    const { container } = render(
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} displayMode="small" />
        </main>,
      ),
    );

    const row = container.querySelector(".gallery-row") as HTMLElement;
    expect(row.style.gridTemplateColumns).toContain("repeat");
  });

  it("puts one item per row in list mode", () => {
    const { container } = render(
      withGallerySelection(
        <main className="main">
          <Gallery items={[imageItem, videoItem]} onSelect={vi.fn()} displayMode="list" />
        </main>,
      ),
    );

    expect(container.querySelectorAll(".gallery-row")).toHaveLength(2);
    // List mode swaps the card out for a row component entirely.
    expect(container.querySelectorAll(".gallery-list-row")).toHaveLength(2);
    expect(container.querySelector(".card")).toBeNull();
  });

  it("keeps selection working in list and small mode", () => {
    for (const displayMode of ["list", "small"] as const) {
      const onSelect = vi.fn();
      const toggleSelectedPath = vi.fn();

      const { unmount } = render(
        withGallerySelection(
          <main className="main">
            <Gallery items={[imageItem, videoItem]} onSelect={onSelect} displayMode={displayMode} />
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

      unmount();
    }
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
