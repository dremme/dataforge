import { StrictMode } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThumbnailProvider } from "@/features/gallery/context/ThumbnailProvider";
import { renderWithThumbnails } from "@/test/renderWithThumbnails";
import { installThumbnailImages } from "@/test/thumbnailImages";
import { installThumbnailIntersections } from "@/test/thumbnailIntersections";
import * as scrollRoot from "@/features/gallery/lib/scrollRoot";
import { GalleryCardMedia } from "./GalleryCardMedia";

const item = {
  path: "C:\\Photos\\frame.jpg",
  name: "frame.jpg",
  media_type: "image" as const,
  size: 100,
};
const visible = { shouldLoad: true, shouldKeep: true, priority: "visible" as const };
let loads: ReturnType<typeof installThumbnailImages>;

beforeEach(() => {
  loads = installThumbnailImages();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GalleryCardMedia", () => {
  it("keeps the placeholder until the rendered thumbnail loads", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container } = renderWithThumbnails(<GalleryCardMedia item={item} />);
    expect(container.querySelector("img")).toBeNull();
    act(() => {
      loads.load();
    });
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toContain("/api/thumbnail?");
    expect(image).not.toHaveClass("card__img--ready");
    fireEvent.load(image);
    expect(image).toHaveClass("card__img--ready");
    expect(image).toHaveAttribute("draggable", "false");
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
  });

  it("recognizes already complete browser-cached images", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400);
    const { container } = renderWithThumbnails(<GalleryCardMedia item={item} />);
    act(() => {
      loads.load();
    });
    expect(container.querySelector("img")).toHaveClass("card__img--ready");
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
  });

  it("loads captured frames on modal close without scrolling", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container, rerender } = render(
      <ThumbnailProvider paused>
        <GalleryCardMedia item={item} />
      </ThumbnailProvider>,
    );
    expect(loads.images).toHaveLength(0);
    rerender(
      <ThumbnailProvider>
        <GalleryCardMedia item={item} />
      </ThumbnailProvider>,
    );
    expect(loads.images).toHaveLength(1);
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
  });

  it("survives Strict Mode cleanup and releases resources on unmount", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container, unmount } = render(
      <StrictMode>
        <ThumbnailProvider>
          <GalleryCardMedia item={item} />
        </ThumbnailProvider>
      </StrictMode>,
    );
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
    unmount();
    expect(loads.images.every((image) => image.onload === null)).toBe(true);
  });

  it("requires the new revision to load instead of reusing the old ready state", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container, rerender } = renderWithThumbnails(<GalleryCardMedia item={item} />);
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    rerender(<GalleryCardMedia item={{ ...item, size: 200 }} />);
    expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
    act(() => {
      loads.load();
    });
    expect(container.querySelector("img")).not.toHaveClass("card__img--ready");
    expect(container.querySelector("img")?.getAttribute("src")).toContain("v=200");
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
  });

  it("keeps cached sources across layout remounts and folder navigation", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container, rerender } = renderWithThumbnails(
      <GalleryCardMedia key="large" item={item} />,
    );
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    rerender(<GalleryCardMedia key="small" item={item} />);
    expect(loads.images).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("frame.jpg");
    rerender(<GalleryCardMedia item={{ ...item, path: "C:\\Photos\\Other\\lake.jpg" }} />);
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    rerender(<GalleryCardMedia key="list" item={item} />);
    expect(loads.images).toHaveLength(2);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("frame.jpg");
  });

  it.each(["image", "gif"] as const)(
    "uses the original %s after a thumbnail error",
    (media_type) => {
      vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
      const { container } = renderWithThumbnails(
        <GalleryCardMedia item={{ ...item, media_type }} />,
      );
      act(() => {
        loads.fail();
        loads.load();
      });
      expect(container.querySelector("img")?.getAttribute("src")).toContain("/api/media?");
      fireEvent.load(container.querySelector("img")!);
      expect(container.querySelector(".card__media-placeholder")).toBeNull();
    },
  );

  it("reports rendered-image errors back to the store", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container } = renderWithThumbnails(<GalleryCardMedia item={item} />);
    act(() => {
      loads.load();
    });
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
    expect(loads.images.at(-1)?.getAttribute("src")).toContain("/api/media?");
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
  });

  it("keeps an unreadable video as a placeholder", () => {
    vi.spyOn(scrollRoot, "getGalleryMediaZones").mockReturnValue(visible);
    const { container } = renderWithThumbnails(
      <GalleryCardMedia item={{ ...item, media_type: "video" }} />,
    );
    act(() => {
      loads.fail();
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
  });

  it("loads reordered cards inside the retention boundary without a scroll event", async () => {
    let top = 1600;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("card__media-surface")
        ? new DOMRect(0, top, 200, 200)
        : new DOMRect(0, 0, 800, 600);
    });
    const intersections = installThumbnailIntersections();
    const { container, unmount } = renderWithThumbnails(
      <main>
        <GalleryCardMedia item={item} />
      </main>,
    );
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(loads.images).toHaveLength(0);
    top = 100;
    act(intersections.sync);
    expect(loads.images).toHaveLength(1);
    act(() => {
      loads.load();
    });
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
    top = 1600;
    act(intersections.sync);
    expect(container.querySelector("img")).not.toBeNull();
    top = 2000;
    act(intersections.sync);
    expect(container.querySelector("img")).toBeNull();
    top = 100;
    act(intersections.sync);
    expect(loads.images).toHaveLength(1);
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("img")).not.toHaveClass("card__img--ready");
    expect(container.querySelector(".card__media-placeholder")).not.toBeNull();
    fireEvent.load(container.querySelector("img")!);
    expect(container.querySelector(".card__media-placeholder")).toBeNull();
    unmount();
    expect(intersections.count()).toBe(0);
  });
});
