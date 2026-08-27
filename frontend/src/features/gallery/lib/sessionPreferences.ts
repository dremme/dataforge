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

  // searchFolders is the pre-rename key; filter/fileFilter hold retired values not in the unions.
  const parsed = value as Omit<Partial<GallerySessionQuery>, "filter" | "fileFilter"> & {
    filter?: unknown;
    fileFilter?: unknown;
    searchFolders?: unknown;
    duplicatesOnly?: unknown;
    pendingOnly?: unknown;
  };
  const storedNames =
    typeof parsed.searchNames === "boolean"
      ? parsed.searchNames
      : typeof parsed.searchFolders === "boolean"
        ? parsed.searchFolders
        : true;
  // Retired filter: "duplicate"; without this a session in flight would silently lose it.
  const storedDuplicateFilter = parsed.filter === "duplicate";
  const filter = typeof parsed.filter === "string" ? parsed.filter : null;

  // Retired booleans: duplicates wins where a session had both on.
  const storedFileFilter: FileFilter =
    parsed.duplicatesOnly === true || storedDuplicateFilter
      ? "duplicates"
      : parsed.pendingOnly === true
        ? "candidates"
        : "all";
  // Retired fileFilter: "pending"; without this a session in flight would widen to every file.
  const rawFileFilter = typeof parsed.fileFilter === "string" ? parsed.fileFilter : null;
  const fileFilter = rawFileFilter === "pending" ? "candidates" : rawFileFilter;

  return {
    filter: isItemFilter(filter) ? filter : "all",
    mediaTypeFilter: isMediaTypeFilter(parsed.mediaTypeFilter ?? null)
      ? parsed.mediaTypeFilter!
      : "all",
    fileFilter: isFileFilter(fileFilter) ? fileFilter : storedFileFilter,
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
      fileFilter: partial.fileFilter ?? current.fileFilter,
      searchQuery: partial.searchQuery ?? current.searchQuery,
      searchRegex: partial.searchRegex ?? current.searchRegex,
      searchNames: partial.searchNames ?? current.searchNames,
    } satisfies GallerySessionQuery,
    "session",
  );
}
