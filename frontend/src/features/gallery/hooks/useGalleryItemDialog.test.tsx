import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import { useGalleryItemDialog } from "./useGalleryItemDialog";

function item(name: string): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    tags: [],
    has_candidate: false,
    caption_status: "none",
    media_type: "image",
    width: 1920,
    height: 1080,
  };
}

/** The grid sorts before it opens the dialog, so navigation order is display order. */
const images = [item("beach.jpg"), item("sunset.png"), item("waves.mp4")];

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

function renderDialog() {
  return renderHook(() => useGalleryItemDialog(images, images), { wrapper });
}

describe("useGalleryItemDialog", () => {
  it("jumps straight to an index in the navigation list", () => {
    const { result } = renderDialog();

    act(() => result.current.openGalleryItem(images[0].path));
    act(() => result.current.goToIndex(2));
    expect(result.current.selectedPath).toBe(images[2].path);

    act(() => result.current.goToIndex(images.length));
    expect(result.current.selectedPath).toBe(images[2].path);
  });

  it("hands the slot to whichever item slides into the removed one's index", () => {
    const { result } = renderDialog();

    act(() => result.current.openGalleryItem(images[1].path));
    expect(result.current.selectedIndex).toBe(1);

    act(() => result.current.removeGalleryItem(images[1].path));

    // Not the alphabetical neighbour — the item now occupying index 1.
    expect(result.current.selectedPath).toBe(images[2].path);
    expect(result.current.dialogItems.map((entry) => entry.name)).toEqual([
      "beach.jpg",
      "waves.mp4",
    ]);
  });

  it("clamps to the last item when the removed one was at the end", () => {
    const { result } = renderDialog();

    act(() => result.current.openGalleryItem(images[2].path));
    act(() => result.current.removeGalleryItem(images[2].path));

    expect(result.current.selectedPath).toBe(images[1].path);
  });

  it("leaves an untouched selection where it is", () => {
    const { result } = renderDialog();

    act(() => result.current.openGalleryItem(images[2].path));
    act(() => result.current.removeGalleryItem(images[0].path));

    expect(result.current.selectedPath).toBe(images[2].path);
    expect(result.current.dialogItems).toHaveLength(2);
  });

  it("follows a renamed item in place once the listing carries the new name", () => {
    const renamed = { ...images[1], name: "dusk.png", path: "C:\\Photos\\dusk.png" };
    const { result, rerender } = renderHook(({ list }) => useGalleryItemDialog(list, list), {
      initialProps: { list: images },
      wrapper,
    });

    act(() => result.current.openGalleryItem(images[1].path));
    // One batch, as the gallery session does it: the listing never lacks the open item.
    act(() => {
      result.current.renameGalleryItem(images[1].path, renamed.path);
      rerender({ list: [images[0], renamed, images[2]] });
    });

    expect(result.current.selectedPath).toBe(renamed.path);
    expect(result.current.selectedIndex).toBe(1);
    expect(result.current.dialogItems.map((entry) => entry.name)).toEqual([
      "beach.jpg",
      "dusk.png",
      "waves.mp4",
    ]);
  });

  it("leaves the selection alone when a different item is renamed", () => {
    const { result } = renderDialog();

    act(() => result.current.openGalleryItem(images[2].path));
    act(() => result.current.renameGalleryItem(images[0].path, "C:\\Photos\\shore.jpg"));

    expect(result.current.selectedPath).toBe(images[2].path);
  });

  it("moves to the next item when the listing drops the open item before the delete returns", () => {
    const { result, rerender } = renderHook(({ list }) => useGalleryItemDialog(list, list), {
      initialProps: { list: images },
      wrapper,
    });

    act(() => result.current.openGalleryItem(images[1].path));
    // A folder push can land while the delete request is still in flight.
    act(() => rerender({ list: [images[0], images[2]] }));

    expect(result.current.selectedPath).toBe(images[2].path);

    act(() => result.current.removeGalleryItem(images[1].path));

    expect(result.current.selectedPath).toBe(images[2].path);
    expect(result.current.selectedIndex).toBe(1);
  });

  it("skips items already gone from the listing when removing several at once", () => {
    const { result, rerender } = renderHook(({ list }) => useGalleryItemDialog(list, list), {
      initialProps: { list: images },
      wrapper,
    });

    act(() => result.current.openGalleryItem(images[0].path));
    act(() => {
      result.current.removeGalleryItem(images[0].path);
      result.current.removeGalleryItem(images[1].path);
      rerender({ list: [images[2]] });
    });

    expect(result.current.selectedPath).toBe(images[2].path);
  });

  it("closes the dialog once the last item is removed", () => {
    const { result } = renderHook(() => useGalleryItemDialog([images[0]], [images[0]]), {
      wrapper,
    });

    act(() => result.current.openGalleryItem(images[0].path));
    act(() => result.current.removeGalleryItem(images[0].path));

    expect(result.current.selectedPath).toBeNull();
    expect(result.current.selectedIndex).toBe(-1);
  });
});
