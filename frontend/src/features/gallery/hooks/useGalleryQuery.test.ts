import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FILTER_OPTIONS } from "@/features/gallery/lib/filters";
import { useGalleryQuery } from "./useGalleryQuery";
import type { GalleryItem } from "@/shared/types";

function item(
  name: string,
  mediaType: GalleryItem["media_type"],
  hasDescription: boolean,
  hasIssue: boolean,
  hasDuplicate = false,
): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: hasDescription ? "caption" : null,
    has_description: hasDescription,
    has_caption_file: hasDescription,
    issue_fixes: hasIssue ? ["Mention the mountain peak."] : [],
    has_issue_file: hasIssue,
    has_duplicate_file: hasDuplicate,
    caption_status: hasDescription ? "text" : "none",
    caption_file_type: hasDescription ? "txt" : null,
    media_type: mediaType,
  };
}

const items = [
  item("a.png", "image", true, true),
  item("b.jpg", "image", false, false),
  item("c.mp4", "video", true, false),
  item("d.mp4", "video", false, false),
];

/**
 * Deliberately crosses all three axes — duplicates that are captioned and uncaptioned,
 * images and video, plus non-duplicates in both caption states. A fixture where the axes
 * lined up would pass even with the scoping wired wrongly.
 *
 * The `shot` token every name but the last shares is load-bearing: searching it keeps a mix
 * of duplicates *and* non-duplicates, so a count that forgot to apply the duplicates axis
 * comes out different. A term that happened to select exactly the duplicates would hide
 * precisely the bug these tests exist to catch. `other.png` is the one item the search
 * drops, so the search itself does work too.
 */
const crossItems = [
  item("dup-uncap-shot.png", "image", false, false, true),
  item("dup-cap-shot.png", "image", true, false, true),
  item("plain-uncap-shot.png", "image", false, false, false),
  item("dup-cap-shot.mp4", "video", true, false, true),
  item("plain-issue-shot.mp4", "video", true, true, false),
  item("other.png", "image", true, false, false),
];

describe("useGalleryQuery", () => {
  it("scopes caption filter counts by the active media type filter", () => {
    const { result } = renderHook(() => useGalleryQuery(items));

    expect(result.current.filterCounts).toEqual({
      all: 4,
      captioned: 2,
      issue: 1,
      uncaptioned: 2,
    });

    act(() => {
      result.current.setMediaTypeFilter("video");
    });

    expect(result.current.filterCounts).toEqual({
      all: 2,
      captioned: 1,
      issue: 0,
      uncaptioned: 1,
    });
  });

  it("scopes media type filter counts by the active caption filter", () => {
    const { result } = renderHook(() => useGalleryQuery(items));

    expect(result.current.mediaTypeFilterCounts).toEqual({
      all: 4,
      image: 2,
      video: 2,
    });

    act(() => {
      result.current.setFilter("captioned");
    });

    expect(result.current.mediaTypeFilterCounts).toEqual({
      all: 2,
      image: 1,
      video: 1,
    });
  });

  it("returns filter empty state when caption filters match no items", () => {
    const uncaptionedItems = [
      item("b.jpg", "image", false, false),
      item("d.mp4", "video", false, false),
    ];
    const { result } = renderHook(() => useGalleryQuery(uncaptionedItems));

    act(() => {
      result.current.setFilter("captioned");
    });

    expect(result.current.filteredItems).toHaveLength(0);
    expect(result.current.filterEmptyState.title).toBe("No captioned files");
  });

  it("returns media-type empty state when the folder has no videos", () => {
    const imageOnlyItems = [
      item("a.png", "image", true, false),
      item("b.jpg", "image", false, false),
    ];
    const { result } = renderHook(() => useGalleryQuery(imageOnlyItems));

    act(() => {
      result.current.setMediaTypeFilter("video");
    });

    expect(result.current.filteredItems).toHaveLength(0);
    expect(result.current.filterEmptyState.title).toBe("No videos");
  });

  it("scopes caption filter counts by the active search query", () => {
    const issueItems = [
      item("wide-414w-2x.png", "image", true, true),
      item("wide-414w-2x-alt.png", "image", true, true),
      item("plain-pre.png", "image", true, true),
      item("clean.png", "image", true, false),
    ];
    const { result } = renderHook(() => useGalleryQuery(issueItems));

    expect(result.current.filterCounts.issue).toBe(3);

    act(() => {
      result.current.setSearchQuery("414w");
    });

    expect(result.current.filterCounts).toEqual({
      all: 2,
      captioned: 2,
      issue: 2,
      uncaptioned: 0,
    });
    expect(result.current.filteredItems).toHaveLength(2);
  });

  it("reports active filters when search or filter state narrows the gallery", () => {
    const { result } = renderHook(() => useGalleryQuery(items));

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.hasActiveSearch).toBe(false);

    act(() => {
      result.current.setMediaTypeFilter("video");
    });

    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.setSearchQuery("a.png");
    });

    expect(result.current.hasActiveSearch).toBe(true);
  });

  it("counts duplicates as its own axis", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    expect(result.current.duplicateCount).toBe(3);
    expect(result.current.duplicatesOnly).toBe(false);
  });

  it("narrows the gallery to duplicates and back", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.filteredItems.map((entry) => entry.name)).toEqual([
      "dup-cap-shot.mp4",
      "dup-cap-shot.png",
      "dup-uncap-shot.png",
    ]);

    act(() => {
      result.current.setDuplicatesOnly(false);
    });

    expect(result.current.filteredItems).toHaveLength(6);
  });

  // The whole point of the split: the two filters compose instead of displacing each other.
  it("combines duplicates with the caption filter", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });
    act(() => {
      result.current.setFilter("uncaptioned");
    });

    expect(result.current.filter).toBe("uncaptioned");
    expect(result.current.duplicatesOnly).toBe(true);
    expect(result.current.filteredItems.map((entry) => entry.name)).toEqual(["dup-uncap-shot.png"]);
  });

  it("treats duplicates as an active filter on its own", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("scopes caption counts by the duplicates toggle", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    expect(result.current.filterCounts).toEqual({
      all: 6,
      captioned: 4,
      issue: 1,
      uncaptioned: 2,
    });

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.filterCounts).toEqual({
      all: 3,
      captioned: 2,
      issue: 0,
      uncaptioned: 1,
    });
  });

  it("scopes media type counts by the duplicates toggle", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.mediaTypeFilterCounts).toEqual({ all: 3, image: 2, video: 1 });
  });

  it("scopes the duplicate count by the caption filter and media type", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setFilter("uncaptioned");
    });

    expect(result.current.duplicateCount).toBe(1);

    act(() => {
      result.current.setFilter("captioned");
      result.current.setMediaTypeFilter("video");
    });

    expect(result.current.duplicateCount).toBe(1);
  });

  // Measured with the toggle off on purpose: the number beside it has to say what turning it
  // on would find, and stay put so the user can turn it back off.
  it("holds the duplicate count steady while duplicates is on", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.duplicateCount).toBe(3);
  });

  it("blames the combination when duplicates and a caption filter agree on nothing", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });
    act(() => {
      result.current.setFilter("issue");
    });

    expect(result.current.filteredItems).toHaveLength(0);
    expect(result.current.filterEmptyState.title).toBe("No matching duplicates");
  });

  it("reports an absence of duplicates when duplicates is the only filter", () => {
    const noDuplicates = [
      item("a.png", "image", true, false),
      item("b.jpg", "image", false, false),
    ];
    const { result } = renderHook(() => useGalleryQuery(noDuplicates));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.filteredItems).toHaveLength(0);
    expect(result.current.filterEmptyState.title).toBe("No duplicates");
  });

  /**
   * Every count in the filter menu promises "this many items if you pick me". With three
   * composable axes that is the assertion most likely to rot, so it is checked directly:
   * with duplicates on and a search running, each caption option's count must equal what
   * selecting it actually leaves on screen.
   */
  it("keeps every caption count equal to what selecting it yields", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setDuplicatesOnly(true);
    });
    act(() => {
      result.current.setSearchQuery("shot");
    });

    // Captured once: these counts are scoped by the *other* axes, so switching `filter`
    // must not move them. Re-reading inside the loop would hide it if they did.
    const counts = result.current.filterCounts;

    for (const option of FILTER_OPTIONS) {
      act(() => {
        result.current.setFilter(option.value);
      });

      expect(result.current.filteredItems).toHaveLength(counts[option.value]);
      expect(result.current.filterCounts).toEqual(counts);
    }
  });

  it("keeps the duplicate count equal to what turning it on yields", () => {
    const { result } = renderHook(() => useGalleryQuery(crossItems));

    act(() => {
      result.current.setFilter("captioned");
    });
    act(() => {
      result.current.setSearchQuery("shot");
    });

    const expected = result.current.duplicateCount;

    act(() => {
      result.current.setDuplicatesOnly(true);
    });

    expect(result.current.filteredItems).toHaveLength(expected);
  });
});
