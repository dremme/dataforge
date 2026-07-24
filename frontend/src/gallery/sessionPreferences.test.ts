import { afterEach, describe, expect, it } from "vitest";
import { cacheGallerySessionQuery, readGallerySessionQuery } from "./sessionPreferences";

const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

describe("gallery session preferences", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("reads and writes the unified session query key", () => {
    cacheGallerySessionQuery({
      filter: "captioned",
      mediaTypeFilter: "image",
      searchQuery: "sunset",
      searchRegex: true,
    });

    expect(window.sessionStorage.getItem(SESSION_QUERY_CACHE_KEY)).toBe(
      JSON.stringify({
        filter: "captioned",
        mediaTypeFilter: "image",
        searchQuery: "sunset",
        searchRegex: true,
      }),
    );
    expect(readGallerySessionQuery()).toEqual({
      filter: "captioned",
      mediaTypeFilter: "image",
      searchQuery: "sunset",
      searchRegex: true,
    });
  });

  it("merges partial updates with the current session query", () => {
    cacheGallerySessionQuery({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      searchQuery: "lake",
      searchRegex: false,
    });

    cacheGallerySessionQuery({ searchQuery: "mountain" });

    expect(readGallerySessionQuery()).toEqual({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      searchQuery: "mountain",
      searchRegex: false,
    });
  });

  it("migrates legacy session keys into the unified cache", () => {
    window.sessionStorage.setItem("gallery-filter", "captioned");
    window.sessionStorage.setItem("gallery-media-type-filter", "video");
    window.sessionStorage.setItem("gallery-search", "waves");

    expect(readGallerySessionQuery()).toEqual({
      filter: "captioned",
      mediaTypeFilter: "video",
      searchQuery: "waves",
      searchRegex: false,
    });
    expect(window.sessionStorage.getItem(SESSION_QUERY_CACHE_KEY)).toBe(
      JSON.stringify({
        filter: "captioned",
        mediaTypeFilter: "video",
        searchQuery: "waves",
        searchRegex: false,
      }),
    );
    expect(window.sessionStorage.getItem("gallery-filter")).toBeNull();
    expect(window.sessionStorage.getItem("gallery-media-type-filter")).toBeNull();
    expect(window.sessionStorage.getItem("gallery-search")).toBeNull();
  });

  it("falls back safely when stored JSON is invalid", () => {
    window.sessionStorage.setItem(SESSION_QUERY_CACHE_KEY, "{not-json");

    expect(readGallerySessionQuery()).toEqual({
      filter: "all",
      mediaTypeFilter: "all",
      searchQuery: "",
      searchRegex: false,
    });
  });

  it("falls back when stored filter values are invalid", () => {
    window.sessionStorage.setItem(
      SESSION_QUERY_CACHE_KEY,
      JSON.stringify({
        filter: "bogus",
        mediaTypeFilter: "bogus",
        searchQuery: 42,
        searchRegex: "",
      }),
    );

    expect(readGallerySessionQuery()).toEqual({
      filter: "all",
      mediaTypeFilter: "all",
      searchQuery: "",
      searchRegex: false,
    });
  });
});
