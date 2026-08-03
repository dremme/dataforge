import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGalleryQuery } from "./useGalleryQuery";
import type { GalleryItem } from "@/shared/types";

function item(
  name: string,
  mediaType: GalleryItem["media_type"],
  hasDescription: boolean,
  hasIssue: boolean,
): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: hasDescription ? "caption" : null,
    has_description: hasDescription,
    has_caption_file: hasDescription,
    issue_fixes: hasIssue ? ["Mention the mountain peak."] : [],
    has_issue_file: hasIssue,
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
});
