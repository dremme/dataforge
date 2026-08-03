import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { useGalleryItemModal } from "./useGalleryItemModal";

function item(name: string): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    has_bboxes: false,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: "image",
    width: 1920,
    height: 1080,
  };
}

/** The grid sorts before it opens the modal, so navigation order is display order. */
const images = [item("beach.jpg"), item("sunset.png"), item("waves.mp4")];

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

function renderModal() {
  return renderHook(() => useGalleryItemModal(images, images), { wrapper });
}

describe("useGalleryItemModal", () => {
  it("hands the slot to whichever item slides into the removed one's index", () => {
    const { result } = renderModal();

    act(() => result.current.openGalleryItem(images[1].path));
    expect(result.current.selectedIndex).toBe(1);

    act(() => result.current.removeGalleryItem(images[1].path));

    // Not the alphabetical neighbour — the item now occupying index 1.
    expect(result.current.selectedPath).toBe(images[2].path);
    expect(result.current.modalItems.map((entry) => entry.name)).toEqual([
      "beach.jpg",
      "waves.mp4",
    ]);
  });

  it("clamps to the last item when the removed one was at the end", () => {
    const { result } = renderModal();

    act(() => result.current.openGalleryItem(images[2].path));
    act(() => result.current.removeGalleryItem(images[2].path));

    expect(result.current.selectedPath).toBe(images[1].path);
  });

  it("leaves an untouched selection where it is", () => {
    const { result } = renderModal();

    act(() => result.current.openGalleryItem(images[2].path));
    act(() => result.current.removeGalleryItem(images[0].path));

    expect(result.current.selectedPath).toBe(images[2].path);
    expect(result.current.modalItems).toHaveLength(2);
  });

  it("closes the modal once the last item is removed", () => {
    const { result } = renderHook(() => useGalleryItemModal([images[0]], [images[0]]), { wrapper });

    act(() => result.current.openGalleryItem(images[0].path));
    act(() => result.current.removeGalleryItem(images[0].path));

    expect(result.current.selectedPath).toBeNull();
    expect(result.current.selectedIndex).toBe(-1);
  });
});
