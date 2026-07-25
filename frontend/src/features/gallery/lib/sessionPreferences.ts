import {
  isCaptionFilter,
  isMediaTypeFilter,
  type CaptionFilter,
  type MediaTypeFilter,
} from "./query";

/** Session-scoped gallery query state (search + filters). Sort uses uiPreferences. */
const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

export interface GallerySessionQuery {
  filter: CaptionFilter;
  mediaTypeFilter: MediaTypeFilter;
  searchQuery: string;
  searchRegex: boolean;
}

const DEFAULT_SESSION_QUERY: GallerySessionQuery = {
  filter: "all",
  mediaTypeFilter: "all",
  searchQuery: "",
  searchRegex: false,
};

function parseStoredSessionQuery(raw: string | null): GallerySessionQuery | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<GallerySessionQuery>;
    const filter: CaptionFilter = isCaptionFilter(parsed.filter ?? null) ? parsed.filter! : "all";
    const mediaTypeFilter: MediaTypeFilter = isMediaTypeFilter(parsed.mediaTypeFilter ?? null)
      ? parsed.mediaTypeFilter!
      : "all";
    return {
      filter,
      mediaTypeFilter,
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
      searchRegex: typeof parsed.searchRegex === "boolean" ? parsed.searchRegex : false,
    };
  } catch {
    return null;
  }
}

export function readGallerySessionQuery(): GallerySessionQuery {
  try {
    return (
      parseStoredSessionQuery(sessionStorage.getItem(SESSION_QUERY_CACHE_KEY)) ??
      DEFAULT_SESSION_QUERY
    );
  } catch {
    return DEFAULT_SESSION_QUERY;
  }
}

export function cacheGallerySessionQuery(partial: Partial<GallerySessionQuery>): void {
  try {
    const current = readGallerySessionQuery();
    const next: GallerySessionQuery = {
      filter: partial.filter ?? current.filter,
      mediaTypeFilter: partial.mediaTypeFilter ?? current.mediaTypeFilter,
      searchQuery: partial.searchQuery ?? current.searchQuery,
      searchRegex: partial.searchRegex ?? current.searchRegex,
    };
    sessionStorage.setItem(SESSION_QUERY_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage access errors
  }
}
