import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import { isItemFilter, isMediaTypeFilter, type ItemFilter, type MediaTypeFilter } from "./query";

/** Session-scoped gallery query state (search + filters). Sort uses uiPreferences. */
const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

export interface GallerySessionQuery {
  filter: ItemFilter;
  mediaTypeFilter: MediaTypeFilter;
  /** Narrows the gallery to duplicate files, on top of whatever `filter` already chose. */
  duplicatesOnly: boolean;
  searchQuery: string;
  searchRegex: boolean;
  /**
   * When true, the search matches file and subfolder names as well as captions.
   * Off searches captions only. Defaults on.
   */
  searchNames: boolean;
}

const DEFAULT_SESSION_QUERY: GallerySessionQuery = {
  filter: "all",
  mediaTypeFilter: "all",
  duplicatesOnly: false,
  searchQuery: "",
  searchRegex: false,
  searchNames: true,
};

function parseStoredSessionQuery(value: unknown): GallerySessionQuery | null {
  if (!value || typeof value !== "object") return null;

  // `searchFolders` is the pre-rename key; honour it so a session in flight when the
  // rename shipped keeps its choice. Storage is session-scoped, so this can be dropped.
  // `filter` is widened back to `unknown`: the retired `"duplicate"` value is no longer in
  // `ItemFilter`, so a typed field could not be compared against it below.
  const parsed = value as Omit<Partial<GallerySessionQuery>, "filter"> & {
    filter?: unknown;
    searchFolders?: unknown;
  };
  const storedNames =
    typeof parsed.searchNames === "boolean"
      ? parsed.searchNames
      : typeof parsed.searchFolders === "boolean"
        ? parsed.searchFolders
        : true;
  // `filter: "duplicate"` is the pre-split value, from when duplicates were one of the
  // caption states. It no longer passes `isItemFilter`, so without this a session in
  // flight when the split shipped would silently lose the filter it was showing.
  // Storage is session-scoped, so this can be dropped.
  const storedDuplicateFilter = parsed.filter === "duplicate";
  const filter = typeof parsed.filter === "string" ? parsed.filter : null;

  return {
    filter: isItemFilter(filter) ? filter : "all",
    mediaTypeFilter: isMediaTypeFilter(parsed.mediaTypeFilter ?? null)
      ? parsed.mediaTypeFilter!
      : "all",
    duplicatesOnly:
      typeof parsed.duplicatesOnly === "boolean" ? parsed.duplicatesOnly : storedDuplicateFilter,
    searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
    searchRegex: typeof parsed.searchRegex === "boolean" ? parsed.searchRegex : false,
    searchNames: storedNames,
  };
}

export function readGallerySessionQuery(): GallerySessionQuery {
  return readStoredJson(
    SESSION_QUERY_CACHE_KEY,
    parseStoredSessionQuery,
    DEFAULT_SESSION_QUERY,
    "session",
  );
}

export function cacheGallerySessionQuery(partial: Partial<GallerySessionQuery>): void {
  const current = readGallerySessionQuery();
  writeStoredJson(
    SESSION_QUERY_CACHE_KEY,
    {
      filter: partial.filter ?? current.filter,
      mediaTypeFilter: partial.mediaTypeFilter ?? current.mediaTypeFilter,
      duplicatesOnly: partial.duplicatesOnly ?? current.duplicatesOnly,
      searchQuery: partial.searchQuery ?? current.searchQuery,
      searchRegex: partial.searchRegex ?? current.searchRegex,
      searchNames: partial.searchNames ?? current.searchNames,
    } satisfies GallerySessionQuery,
    "session",
  );
}
