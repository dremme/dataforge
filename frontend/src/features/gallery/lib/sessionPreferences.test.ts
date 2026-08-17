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
      searchNames: false,
    });

    expect(window.sessionStorage.getItem(SESSION_QUERY_CACHE_KEY)).toBe(
      JSON.stringify({
        filter: "captioned",
        mediaTypeFilter: "image",
        duplicatesOnly: false,
        searchQuery: "sunset",
        searchRegex: true,
        searchNames: false,
      }),
    );
    expect(readGallerySessionQuery()).toEqual({
      filter: "captioned",
      mediaTypeFilter: "image",
      duplicatesOnly: false,
      searchQuery: "sunset",
      searchRegex: true,
      searchNames: false,
    });
  });

  it("merges partial updates with the current session query", () => {
    cacheGallerySessionQuery({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      // Left out of the second write below, so this also covers a `true` boolean surviving
      // a partial merge rather than being read as absent.
      duplicatesOnly: true,
      searchQuery: "lake",
      searchRegex: false,
      searchNames: true,
    });

    cacheGallerySessionQuery({ searchQuery: "mountain" });

    expect(readGallerySessionQuery()).toEqual({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      duplicatesOnly: true,
      searchQuery: "mountain",
      searchRegex: false,
      searchNames: true,
    });
  });

  it("falls back safely when stored JSON is invalid", () => {
    window.sessionStorage.setItem(SESSION_QUERY_CACHE_KEY, "{not-json");

    expect(readGallerySessionQuery()).toEqual({
      filter: "all",
      mediaTypeFilter: "all",
      duplicatesOnly: false,
      searchQuery: "",
      searchRegex: false,
      searchNames: true,
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
        searchNames: "yes",
      }),
    );

    expect(readGallerySessionQuery()).toEqual({
      filter: "all",
      mediaTypeFilter: "all",
      duplicatesOnly: false,
      searchQuery: "",
      searchRegex: false,
      searchNames: true,
    });
  });

  it("defaults searchNames to true when the stored key is missing", () => {
    window.sessionStorage.setItem(
      SESSION_QUERY_CACHE_KEY,
      JSON.stringify({
        filter: "all",
        mediaTypeFilter: "all",
        searchQuery: "",
        searchRegex: false,
      }),
    );

    expect(readGallerySessionQuery().searchNames).toBe(true);
  });

  // `filter: "duplicate"` predates duplicates becoming their own axis. It no longer passes
  // `isItemFilter`, so without the migration a session in flight would silently drop the
  // filter it was showing instead of carrying it over.
  it("carries the retired duplicate filter value over to its own axis", () => {
    window.sessionStorage.setItem(
      SESSION_QUERY_CACHE_KEY,
      JSON.stringify({
        filter: "duplicate",
        mediaTypeFilter: "all",
        searchQuery: "",
        searchRegex: false,
        searchNames: true,
      }),
    );

    const query = readGallerySessionQuery();

    expect(query.duplicatesOnly).toBe(true);
    expect(query.filter).toBe("all");
  });

  it("prefers a stored duplicatesOnly over the retired filter value", () => {
    window.sessionStorage.setItem(
      SESSION_QUERY_CACHE_KEY,
      JSON.stringify({ filter: "duplicate", duplicatesOnly: false }),
    );

    expect(readGallerySessionQuery().duplicatesOnly).toBe(false);
  });

  it("honours the pre-rename searchFolders key", () => {
    window.sessionStorage.setItem(
      SESSION_QUERY_CACHE_KEY,
      JSON.stringify({
        filter: "all",
        mediaTypeFilter: "all",
        searchQuery: "",
        searchRegex: false,
        searchFolders: false,
      }),
    );

    expect(readGallerySessionQuery().searchNames).toBe(false);
  });
});
