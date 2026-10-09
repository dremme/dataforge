import { describe, expect, it } from "vitest";
import { HOME_PATH } from "@/test/fixtures";
import type { GalleryItem } from "@/shared/types";
import { rowMarkers, rowMetaCells } from "./listRowCells";

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name: "clip.mp4",
    path: `${HOME_PATH}\\clip.mp4`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    has_candidate: false,
    caption_status: "none",
    media_type: "video",
    width: 1920,
    height: 1080,
    size: 2_516_582,
    modified_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rowMarkers", () => {
  it("includes a marker when a file has a candidate", () => {
    const markers = rowMarkers(item({ media_type: "image", has_candidate: true }));

    expect(markers.map((marker) => marker.key)).toEqual(["candidate"]);
    expect(markers[0]?.label).toBe("Candidate");
  });

  it("marks an edited image by the original stored beside it", () => {
    const markers = rowMarkers(item({ media_type: "image", has_backup: true }));

    expect(markers.map((marker) => marker.key)).toEqual(["edited"]);
    expect(markers[0]?.label).toBe("Edited");
  });

  it("leaves the media type to the name icon", () => {
    const markers = rowMarkers(item({ has_backup: true }));

    expect(markers.map((marker) => marker.key)).toEqual(["edited"]);
  });

  it("leaves an untouched file unmarked", () => {
    expect(rowMarkers(item({ media_type: "image" }))).toEqual([]);
  });
});

describe("rowMetaCells", () => {
  it("places the aspect ratio beside the megapixels", () => {
    const cells = rowMetaCells(item({ width: 2048, height: 1024 }));
    expect(cells.map((cell) => cell.key)).toEqual([
      "megapixels",
      "aspect-ratio",
      "duration",
      "size",
      "modified",
    ]);
    expect(cells[1]?.value).toBe("~16:9");
  });

  it("leaves the aspect ratio cell empty when the item has no dimensions", () => {
    const cells = rowMetaCells(item({ width: null, height: null }));
    expect(cells.find((cell) => cell.key === "aspect-ratio")?.value).toBe("");
  });

  it("formats a video duration in seconds", () => {
    const cells = rowMetaCells(item({ duration: 5.4 }));
    expect(cells.find((cell) => cell.key === "duration")?.value).toBe("5 s");
  });

  it("leaves the duration cell empty when the item has no length", () => {
    const cells = rowMetaCells(item({ media_type: "image", duration: null }));
    expect(cells.find((cell) => cell.key === "duration")?.value).toBe("");
  });
});
