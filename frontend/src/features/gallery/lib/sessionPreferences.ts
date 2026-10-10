import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import {
  isFileFilter,
  isItemFilter,
  isMediaTypeFilter,
  type FileFilter,
  type ItemFilter,
  type MediaTypeFilter,
} from "./query";

const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

export interface GallerySessionQuery {
  filter: ItemFilter;
  mediaTypeFilter: MediaTypeFilter;
  fileFilter: FileFilter;
  searchQuery: string;
  searchRegex: boolean;
  searchNames: boolean;
}

const DEFAULT_SESSION_QUERY: GallerySessionQuery = {
  filter: "all",
  mediaTypeFilter: "all",
  fileFilter: "all",
  searchQuery: "",
  searchRegex: false,
  searchNames: true,
};

function parseStoredSessionQuery(value: unknown): GallerySessionQuery | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Record<keyof GallerySessionQuery, unknown>;
  const filter = typeof parsed.filter === "string" ? parsed.filter : null;
  const mediaTypeFilter =
    typeof parsed.mediaTypeFilter === "string" ? parsed.mediaTypeFilter : null;
  const fileFilter = typeof parsed.fileFilter === "string" ? parsed.fileFilter : null;

  return {
    filter: isItemFilter(filter) ? filter : "all",
    mediaTypeFilter: isMediaTypeFilter(mediaTypeFilter) ? mediaTypeFilter : "all",
    fileFilter: isFileFilter(fileFilter) ? fileFilter : "all",
    searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
    searchRegex: typeof parsed.searchRegex === "boolean" ? parsed.searchRegex : false,
    searchNames: typeof parsed.searchNames === "boolean" ? parsed.searchNames : true,
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
      fileFilter: partial.fileFilter ?? current.fileFilter,
      searchQuery: partial.searchQuery ?? current.searchQuery,
      searchRegex: partial.searchRegex ?? current.searchRegex,
      searchNames: partial.searchNames ?? current.searchNames,
    } satisfies GallerySessionQuery,
    "session",
  );
}
