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
}

const DEFAULT_SESSION_QUERY: GallerySessionQuery = {
  filter: "all",
  mediaTypeFilter: "all",
  searchQuery: "",
  searchRegex: false,
};

function parseStoredSessionQuery(value: unknown): GallerySessionQuery | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Partial<GallerySessionQuery>;
  return {
    filter: isCaptionFilter(parsed.filter ?? null) ? parsed.filter! : "all",
    mediaTypeFilter: isMediaTypeFilter(parsed.mediaTypeFilter ?? null)
      ? parsed.mediaTypeFilter!
      : "all",
    searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
    searchRegex: typeof parsed.searchRegex === "boolean" ? parsed.searchRegex : false,
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
    } satisfies GallerySessionQuery,
    "session",
  );
}
