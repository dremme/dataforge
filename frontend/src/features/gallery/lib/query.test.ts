import { describe, expect, it } from "vitest";
import {
  applyDuplicateFilter,
  applyItemFilter,
  applyMediaTypeFilter,
  countCaptioned,
  countMediaType,
  filterBySearch,
  filterSubfoldersBySearch,
  parseSortOption,
  processGalleryItems,
  sortGalleryItems,
  type MediaTypeFilter,
  type SortOption,
} from "./query";
import type { GalleryItem, Subfolder } from "@/shared/types";

function folder(name: string): Subfolder {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    file_count: 0,
    captioned_count: 0,
    issue_count: 0,
  };
}

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
    issue_fixes: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: mediaType,
    ...overrides,
  };
}

describe("applyMediaTypeFilter", () => {
  const items = [
    item("a.png", "image"),
    item("b.mp4", "video"),
    item("c.jpg", "image"),
    item("d.gif", "gif"),
  ];

  it.each<[MediaTypeFilter, string[]]>([
    ["all", ["a.png", "b.mp4", "c.jpg", "d.gif"]],
    ["image", ["a.png", "c.jpg"]],
    // GIFs group with video: both carry a frame sequence, which is the distinction
    // the filter is really offering.
    ["video", ["b.mp4", "d.gif"]],
  ])("filters to %s", (filter, expectedNames) => {
    expect(applyMediaTypeFilter(items, filter).map((entry) => entry.name)).toEqual(expectedNames);
  });
});

describe("countMediaType", () => {
  const items = [
    item("a.png", "image"),
    item("b.mp4", "video"),
    item("c.jpg", "image"),
    item("d.gif", "gif"),
  ];

  it("counts images and motion", () => {
    expect(countMediaType(items, "image")).toBe(2);
    expect(countMediaType(items, "video")).toBe(2);
  });

  it.each<MediaTypeFilter>(["all", "image", "video"])(
    "agrees with the grid it labels for %s",
    (filter) => {
      expect(countMediaType(items, filter)).toBe(applyMediaTypeFilter(items, filter).length);
    },
  );
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
      duplicatesOnly: false,
      searchQuery: "",
      searchRegex: false,
      searchNames: true,
      sort: "name-asc",
    });

    expect(result.map((entry) => entry.name)).toEqual(["b.mp4"]);
  });

  // The point of the separate axis: duplicates narrows the caption filter's result rather
  // than replacing it.
  it("narrows the caption filter by duplicates instead of replacing it", () => {
    const mixed = [
      { ...item("kept.png", "image"), has_description: true, has_duplicate_file: true },
      { ...item("captioned.png", "image"), has_description: true },
      { ...item("dupe.png", "image"), has_duplicate_file: true },
    ];

    const result = processGalleryItems(mixed, {
      filter: "captioned",
      mediaTypeFilter: "all",
      duplicatesOnly: true,
      searchQuery: "",
      searchRegex: false,
      searchNames: true,
      sort: "name-asc",
    });

    expect(result.map((entry) => entry.name)).toEqual(["kept.png"]);
  });
});

describe("applyDuplicateFilter", () => {
  const items = [
    item("a.png", "image"),
    { ...item("b.png", "image"), has_duplicate_file: true },
    { ...item("c.png", "image"), has_duplicate_file: true },
  ];

  it("passes everything through when off", () => {
    expect(applyDuplicateFilter(items, false)).toBe(items);
  });

  it("keeps only duplicates when on", () => {
    expect(applyDuplicateFilter(items, true).map((entry) => entry.name)).toEqual([
      "b.png",
      "c.png",
    ]);
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
    expect(filterBySearch(items, "SUN", false, true).map((entry) => entry.name)).toEqual([
      "sunset.png",
    ]);
  });

  it("matches caption text", () => {
    expect(filterBySearch(items, "ocean", false, true).map((entry) => entry.name)).toEqual([
      "waves.mp4",
    ]);
  });

  it("returns all items for blank search", () => {
    expect(filterBySearch(items, "   ", false, true).map((entry) => entry.name)).toEqual([
      "sunset.png",
      "beach.jpg",
      "waves.mp4",
    ]);
  });

  it("matches with a valid regular expression", () => {
    expect(filterBySearch(items, "sun|ocean", true, true).map((entry) => entry.name)).toEqual([
      "sunset.png",
      "waves.mp4",
    ]);
  });

  it("does not crash on an incomplete or invalid regular expression", () => {
    expect(() => filterBySearch(items, "land(scape", true, true)).not.toThrow();
    // Falls back to plain substring match while the pattern is invalid.
    expect(filterBySearch(items, "sunset", true, true).map((entry) => entry.name)).toEqual([
      "sunset.png",
    ]);
    expect(filterBySearch(items, "land(scape", true, true).map((entry) => entry.name)).toEqual([]);
  });

  it("ignores file names when name matching is off", () => {
    expect(filterBySearch(items, "sun", false, false).map((entry) => entry.name)).toEqual([]);
    expect(filterBySearch(items, "golden", false, false).map((entry) => entry.name)).toEqual([
      "sunset.png",
    ]);
  });

  describe("exclusion patterns", () => {
    const captioned = [
      item("portrait_001.png", "image", { description: "a woman standing in a field" }),
      item("portrait_002.png", "image", { description: "a man standing in a field" }),
    ];

    it("excludes captions containing the term when name matching is off", () => {
      expect(
        filterBySearch(captioned, "^((?!woman).)*$", true, false).map((entry) => entry.name),
      ).toEqual(["portrait_002.png"]);
    });

    it("matches everything when name matching is on, since names lack the term", () => {
      expect(
        filterBySearch(captioned, "^((?!woman).)*$", true, true).map((entry) => entry.name),
      ).toEqual(["portrait_001.png", "portrait_002.png"]);
    });

    it("spans multi-line captions", () => {
      const multiline = [
        item("a.png", "image", { description: "a woman standing\nin a field" }),
        item("b.png", "image", { description: "a man standing\nin a field" }),
      ];

      expect(
        filterBySearch(multiline, "^((?!woman).)*$", true, false).map((entry) => entry.name),
      ).toEqual(["b.png"]);
    });

    it("never matches an item without a caption", () => {
      const uncaptioned = [item("beach.jpg", "image")];

      expect(filterBySearch(uncaptioned, "^((?!woman).)*$", true, false)).toEqual([]);
    });
  });
});

describe("filterSubfoldersBySearch", () => {
  const folders = [folder("Vacation"), folder("Sunsets"), folder("Empty")];

  it("matches folder names case-insensitively", () => {
    expect(filterSubfoldersBySearch(folders, "VAC", false).map((entry) => entry.name)).toEqual([
      "Vacation",
    ]);
  });

  it("returns all folders for blank search", () => {
    expect(filterSubfoldersBySearch(folders, "  ", false)).toEqual(folders);
  });

  it("matches with a valid regular expression", () => {
    expect(
      filterSubfoldersBySearch(folders, "^(vac|sun)", true).map((entry) => entry.name),
    ).toEqual(["Vacation", "Sunsets"]);
  });

  it("does not crash on an incomplete regular expression", () => {
    expect(() => filterSubfoldersBySearch(folders, "vac(", true)).not.toThrow();
    expect(filterSubfoldersBySearch(folders, "vac(", true)).toEqual([]);
  });
});

describe("applyItemFilter", () => {
  const items = [
    item("captioned.png", "image", { has_description: true }),
    item("missing.png", "image"),
  ];

  it("filters captioned and uncaptioned items", () => {
    expect(applyItemFilter(items, "captioned").map((entry) => entry.name)).toEqual([
      "captioned.png",
    ]);
    expect(applyItemFilter(items, "uncaptioned").map((entry) => entry.name)).toEqual([
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
