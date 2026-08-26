import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import {
  isFileFilter,
  isItemFilter,
  isMediaTypeFilter,
  type FileFilter,
  type ItemFilter,
  type MediaTypeFilter,
} from "./query";

/** Session-scoped gallery query state (search + filters). Sort uses uiPreferences. */
const SESSION_QUERY_CACHE_KEY = "gallery-session-query";

export interface GallerySessionQuery {
  filter: ItemFilter;
  mediaTypeFilter: MediaTypeFilter;
  /** Narrows to a file property - duplicates or ComfyUI candidates - on top of `filter`. */
  fileFilter: FileFilter;
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
  fileFilter: "all",
  searchQuery: "",
  searchRegex: false,
  searchNames: true,
};

function parseStoredSessionQuery(value: unknown): GallerySessionQuery | null {
  if (!value || typeof value !== "object") return null;

  // `searchFolders` is the pre-rename key; honour it so a session in flight when the
  // rename shipped keeps its choice. Storage is session-scoped, so this can be dropped.
  // `filter` and `fileFilter` are widened back to `unknown`: each has a retired value
  // (`"duplicate"`, `"pending"`) that is no longer in its union, so a typed field could
  // not be compared against it below.
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
  // `filter: "duplicate"` is the pre-split value, from when duplicates were one of the
  // caption states. It no longer passes `isItemFilter`, so without this a session in
  // flight when the split shipped would silently lose the filter it was showing.
  // Storage is session-scoped, so this can be dropped.
  const storedDuplicateFilter = parsed.filter === "duplicate";
  const filter = typeof parsed.filter === "string" ? parsed.filter : null;

  // `duplicatesOnly`/`pendingOnly` are the pre-merge booleans, from when Files held two
  // independent toggles. Duplicates wins where a session had both on - it is the older
  // of the two and the one more likely to be mid-task. Storage is session-scoped, so
  // this can be dropped.
  const storedFileFilter: FileFilter =
    parsed.duplicatesOnly === true || storedDuplicateFilter
      ? "duplicates"
      : parsed.pendingOnly === true
        ? "candidates"
        : "all";
  // `"pending"` is what `"candidates"` was called before the ComfyUI results settled on
  // one name. It no longer passes `isFileFilter`, so a session in flight would otherwise
  // fall back to the stored booleans and quietly widen to every file.
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
