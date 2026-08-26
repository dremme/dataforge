import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { useGalleryListColumns } from "./useGalleryListColumns";

/**
 * jsdom lays nothing out, so every box is zero wide. One character is stood in
 * for one pixel, which is enough to assert what the hook is actually for: that a
 * column follows its widest value rather than a number chosen up front.
 */
const CHARACTER_WIDTH = 1;

let originalGetBoundingClientRect: () => DOMRect;

function widthOf(element: Element): number {
  if (element.classList.contains("gallery-list-row__markers")) {
    return element.childElementCount * 10;
  }
  return (element.textContent?.length ?? 0) * CHARACTER_WIDTH;
}

function item(overrides: Partial<GalleryItem>): GalleryItem {
  return {
    name: "photo.png",
    path: `${HOME_PATH}\\photo.png`,
    description: "A caption.",
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
    ...overrides,
  };
}

function renderColumns(items: GalleryItem[], enabled = true) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ref = { current: host };
  const { result } = renderHook(() => useGalleryListColumns(ref, items, enabled));
  return result.current as Record<string, string> | undefined;
}

describe("useGalleryListColumns", () => {
  beforeEach(() => {
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return { width: widthOf(this), height: 0 } as DOMRect;
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    document.body.innerHTML = "";
  });

  it("sizes a column to the widest value in the folder, not to the first one", () => {
    const small = item({ path: `${HOME_PATH}\\a.png`, size: 1024 });
    const large = item({ path: `${HOME_PATH}\\b.png`, size: 1023 * 1024 });

    // "1.0 KB" alone, then the same folder with a wider "1023 KB" row added.
    const narrow = renderColumns([small]);
    const widened = renderColumns([small, large]);

    expect(narrow?.["--gallery-list-col-size"]).toBe("8.5px");
    expect(widened?.["--gallery-list-col-size"]).toBe("9.5px");
  });

  it("collapses a column no item in the folder has a value for", () => {
    const columns = renderColumns([item({ width: null, height: null })]);

    expect(columns?.["--gallery-list-col-megapixels"]).toBe("0px");
    expect(columns?.["--gallery-list-col-duration"]).toBe("0px");
    expect(columns?.["--gallery-list-col-size"]).not.toBe("0px");
  });

  it("sizes the marker column to the most markers any item carries", () => {
    const one = renderColumns([item({ media_type: "video" })]);
    const three = renderColumns([
      item({
        media_type: "video",
        has_issue_file: true,
        has_duplicate_file: true,
        has_backup: false,
        has_candidate: false,
      }),
    ]);

    expect(one?.["--gallery-list-col-markers"]).toBe("12.5px");
    expect(three?.["--gallery-list-col-markers"]).toBe("32.5px");
  });

  it("measures nothing outside list mode", () => {
    expect(renderColumns([item({})], false)).toBeUndefined();
  });
});
