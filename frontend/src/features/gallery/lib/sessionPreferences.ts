import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
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
  /**
   * When true, the search matches file and subfolder names as well as captions.
   * Off searches captions only. Defaults on.
   */
  searchNames: boolean;
}

const DEFAULT_SESSION_QUERY: GallerySessionQuery = {
  filter: "all",
  mediaTypeFilter: "all",
  searchQuery: "",
  searchRegex: false,
  searchNames: true,
};

function parseStoredSessionQuery(value: unknown): GallerySessionQuery | null {
  if (!value || typeof value !== "object") return null;

  // `searchFolders` is the pre-rename key; honour it so a session in flight when the
  // rename shipped keeps its choice. Storage is session-scoped, so this can be dropped.
  const parsed = value as Partial<GallerySessionQuery> & { searchFolders?: unknown };
  const storedNames =
    typeof parsed.searchNames === "boolean"
      ? parsed.searchNames
      : typeof parsed.searchFolders === "boolean"
        ? parsed.searchFolders
        : true;
  return {
    filter: isCaptionFilter(parsed.filter ?? null) ? parsed.filter! : "all",
    mediaTypeFilter: isMediaTypeFilter(parsed.mediaTypeFilter ?? null)
      ? parsed.mediaTypeFilter!
      : "all",
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
      searchQuery: partial.searchQuery ?? current.searchQuery,
      searchRegex: partial.searchRegex ?? current.searchRegex,
      searchNames: partial.searchNames ?? current.searchNames,
    } satisfies GallerySessionQuery,
    "session",
  );
}
