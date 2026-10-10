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
        fileFilter: "all",
        searchQuery: "sunset",
        searchRegex: true,
        searchNames: false,
      }),
    );
    expect(readGallerySessionQuery()).toEqual({
      filter: "captioned",
      mediaTypeFilter: "image",
      fileFilter: "all",
      searchQuery: "sunset",
      searchRegex: true,
      searchNames: false,
    });
  });

  it("merges partial updates with the current session query", () => {
    cacheGallerySessionQuery({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      // Left out of the second write below, so this also covers a non-default choice
      // surviving a partial merge rather than being read as absent.
      fileFilter: "duplicates",
      searchQuery: "lake",
      searchRegex: false,
      searchNames: true,
    });

    cacheGallerySessionQuery({ searchQuery: "mountain" });

    expect(readGallerySessionQuery()).toEqual({
      filter: "uncaptioned",
      mediaTypeFilter: "all",
      fileFilter: "duplicates",
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
      fileFilter: "all",
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
      fileFilter: "all",
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

  it("reads and writes the file filter", () => {
    cacheGallerySessionQuery({ fileFilter: "candidates" });

    expect(readGallerySessionQuery().fileFilter).toBe("candidates");

    cacheGallerySessionQuery({ searchQuery: "river" });

    expect(readGallerySessionQuery().fileFilter).toBe("candidates");
  });
});
