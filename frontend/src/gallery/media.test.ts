import { describe, expect, it } from "vitest";
import {
  applyCaptionFilter,
  applyMediaTypeFilter,
  countCaptioned,
  countMediaType,
  filterBySearch,
  parseSortOption,
  processGalleryItems,
  sortGalleryItems,
  type MediaTypeFilter,
  type SortOption,
} from "./media";
import type { GalleryItem } from "../types";

function item(
  name: string,
  mediaType: GalleryItem["media_type"],
  overrides: Partial<GalleryItem> = {},
): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue: null,
    issue_suggestions: null,
    has_issue_file: false,
    has_bboxes: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: mediaType,
    ...overrides,
  };
}

describe("applyMediaTypeFilter", () => {
  const items = [item("a.png", "image"), item("b.mp4", "video"), item("c.jpg", "image")];

  it.each<[MediaTypeFilter, string[]]>([
    ["all", ["a.png", "b.mp4", "c.jpg"]],
    ["image", ["a.png", "c.jpg"]],
    ["video", ["b.mp4"]],
  ])("filters to %s", (filter, expectedNames) => {
    expect(applyMediaTypeFilter(items, filter).map((entry) => entry.name)).toEqual(expectedNames);
  });
});

describe("countMediaType", () => {
  const items = [item("a.png", "image"), item("b.mp4", "video"), item("c.jpg", "image")];

  it("counts images and videos", () => {
    expect(countMediaType(items, "image")).toBe(2);
    expect(countMediaType(items, "video")).toBe(1);
  });
});

describe("processGalleryItems", () => {
  const items = [
    item("a.png", "image"),
    { ...item("b.mp4", "video"), has_description: true },
    item("c.jpg", "image"),
  ];

  it("applies media type and caption filters before search and sort", () => {
    const result = processGalleryItems(items, {
      filter: "captioned",
      mediaTypeFilter: "video",
      searchQuery: "",
      searchRegex: false,
      sort: "name-asc",
    });

    expect(result.map((entry) => entry.name)).toEqual(["b.mp4"]);
  });
});

describe("sortGalleryItems", () => {
  const items = [
    item("bravo.png", "image", {
      modified_at: "2026-01-02T00:00:00Z",
      size: 200,
      width: 1280,
      height: 720,
      description: "y".repeat(50),
    }),
    item("alpha.png", "image", {
      modified_at: "2026-01-03T00:00:00Z",
      size: 100,
      width: 1920,
      height: 1080,
      description: "x".repeat(100),
    }),
    item("charlie.png", "image", {
      modified_at: "2026-01-01T00:00:00Z",
      size: 300,
      width: 640,
      height: 480,
      description: "z".repeat(10),
    }),
  ];

  it.each<[SortOption, string[]]>([
    ["name-asc", ["alpha.png", "bravo.png", "charlie.png"]],
    ["name-desc", ["charlie.png", "bravo.png", "alpha.png"]],
    ["date-asc", ["charlie.png", "bravo.png", "alpha.png"]],
    ["date-desc", ["alpha.png", "bravo.png", "charlie.png"]],
    ["caption-asc", ["charlie.png", "bravo.png", "alpha.png"]],
    ["caption-desc", ["alpha.png", "bravo.png", "charlie.png"]],
    ["megapixels-asc", ["charlie.png", "bravo.png", "alpha.png"]],
    ["megapixels-desc", ["alpha.png", "bravo.png", "charlie.png"]],
  ])("sorts by %s", (sort, expectedNames) => {
    expect(sortGalleryItems(items, sort).map((entry) => entry.name)).toEqual(expectedNames);
  });

  it("places items without dimensions first when sorting megapixels ascending", () => {
    const withMissing = [
      item("large.png", "image", { width: 2000, height: 2000 }),
      item("missing.png", "image"),
      item("small.png", "image", { width: 100, height: 100 }),
    ];

    expect(sortGalleryItems(withMissing, "megapixels-asc").map((entry) => entry.name)).toEqual([
      "missing.png",
      "small.png",
      "large.png",
    ]);
  });
});

describe("filterBySearch", () => {
  const items = [
    item("sunset.png", "image", { description: "Golden hour" }),
    item("beach.jpg", "image"),
    item("waves.mp4", "video", { description: "Ocean waves" }),
  ];

  it("matches file names case-insensitively", () => {
    expect(filterBySearch(items, "SUN", false).map((entry) => entry.name)).toEqual(["sunset.png"]);
  });

  it("matches caption text", () => {
    expect(filterBySearch(items, "ocean", false).map((entry) => entry.name)).toEqual(["waves.mp4"]);
  });

  it("returns all items for blank search", () => {
    expect(filterBySearch(items, "   ", false).map((entry) => entry.name)).toEqual([
      "sunset.png",
      "beach.jpg",
      "waves.mp4",
    ]);
  });
});

describe("applyCaptionFilter", () => {
  const items = [
    item("captioned.png", "image", { has_description: true }),
    item("missing.png", "image"),
  ];

  it("filters captioned and uncaptioned items", () => {
    expect(applyCaptionFilter(items, "captioned").map((entry) => entry.name)).toEqual([
      "captioned.png",
    ]);
    expect(applyCaptionFilter(items, "uncaptioned").map((entry) => entry.name)).toEqual([
      "missing.png",
    ]);
  });
});

describe("countCaptioned", () => {
  it("counts items with descriptions", () => {
    const items = [item("a.png", "image", { has_description: true }), item("b.png", "image")];

    expect(countCaptioned(items)).toBe(1);
  });
});

describe("parseSortOption", () => {
  it("falls back to the default for invalid values", () => {
    expect(parseSortOption("not-a-sort")).toBe("name-asc");
    expect(parseSortOption("date-desc")).toBe("date-desc");
    expect(parseSortOption("megapixels-desc")).toBe("megapixels-desc");
  });
});
