import {
  isCaptionFilter,
  isMediaTypeFilter,
  type CaptionFilter,
  type MediaTypeFilter,
} from "./query";

/** Session-scoped gallery query state (search + filters). Sort uses uiPreferences. */
const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

/** @deprecated Legacy keys — read once for migration, then ignored. */
const LEGACY_FILTER_CACHE_KEY = "gallery-filter";
/** @deprecated */
const LEGACY_MEDIA_TYPE_FILTER_CACHE_KEY = "gallery-media-type-filter";
/** @deprecated */
const LEGACY_SEARCH_CACHE_KEY = "gallery-search";

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

/** @deprecated */
function readLegacySessionQuery(): GallerySessionQuery | null {
  try {
    const filterValue = sessionStorage.getItem(LEGACY_FILTER_CACHE_KEY);
    const mediaTypeFilterValue = sessionStorage.getItem(LEGACY_MEDIA_TYPE_FILTER_CACHE_KEY);
    const searchQuery = sessionStorage.getItem(LEGACY_SEARCH_CACHE_KEY);

    if (filterValue === null && mediaTypeFilterValue === null && searchQuery === null) {
      return null;
    }

    return {
      filter: isCaptionFilter(filterValue) ? filterValue : "all",
      mediaTypeFilter: isMediaTypeFilter(mediaTypeFilterValue) ? mediaTypeFilterValue : "all",
      searchQuery: searchQuery ?? "",
      searchRegex: false,
    };
  } catch {
    return null;
  }
}

/** @deprecated */
function clearLegacySessionQuery(): void {
  sessionStorage.removeItem(LEGACY_FILTER_CACHE_KEY);
  sessionStorage.removeItem(LEGACY_MEDIA_TYPE_FILTER_CACHE_KEY);
  sessionStorage.removeItem(LEGACY_SEARCH_CACHE_KEY);
}

export function readGallerySessionQuery(): GallerySessionQuery {
  try {
    const stored = parseStoredSessionQuery(sessionStorage.getItem(SESSION_QUERY_CACHE_KEY));
    if (stored) return stored;

    const legacy = readLegacySessionQuery();
    if (legacy) {
      cacheGallerySessionQuery(legacy);
      clearLegacySessionQuery();
      return legacy;
    }

    return DEFAULT_SESSION_QUERY;
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
