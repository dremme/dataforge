import { isResolvableIssueItem } from "./issues";
import { isDuplicateItem } from "./duplicates";
import { isCandidateItem } from "./candidateReview";
import { isMotion } from "@/features/gallery/lib/itemKind";
import { durationSeconds } from "@/shared/lib/format";
import type { GalleryItem, GallerySort, Subfolder } from "@/shared/types";

export type SortOption = GallerySort;

/**
 * One caption state at a time. `duplicate` used to live in here, which is what the name
 * `ItemFilter` was chosen for - but a duplicate is a property of the file rather than of
 * its caption, so it now filters on its own axis (`FileFilter`) and composes with this
 * one instead of displacing it.
 */
export type ItemFilter = "all" | "captioned" | "issue" | "uncaptioned";

/** `video` means "has motion", so it covers GIFs as well as MP4s. */
export type MediaTypeFilter = "all" | "image" | "video";

/**
 * A property of the file rather than of its caption, so it narrows whatever the caption
 * and media-type axes already chose.
 *
 * One of many rather than two independent toggles, matching the other two axes. The pair
 * could only ever intersect into an empty grid - a candidate is not also a duplicate - so
 * the combination cost a menu section and answered nothing.
 */
export type FileFilter = "all" | "duplicates" | "candidates";

const ITEM_FILTER_VALUES = new Set<ItemFilter>(["all", "captioned", "issue", "uncaptioned"]);

const MEDIA_TYPE_FILTER_VALUES = new Set<MediaTypeFilter>(["all", "image", "video"]);

const FILE_FILTER_VALUES = new Set<FileFilter>(["all", "duplicates", "candidates"]);

export function isItemFilter(value: string | null): value is ItemFilter {
  return value !== null && ITEM_FILTER_VALUES.has(value as ItemFilter);
}

export function isMediaTypeFilter(value: string | null): value is MediaTypeFilter {
  return value !== null && MEDIA_TYPE_FILTER_VALUES.has(value as MediaTypeFilter);
}

export function isFileFilter(value: string | null): value is FileFilter {
  return value !== null && FILE_FILTER_VALUES.has(value as FileFilter);
}

export const DEFAULT_SORT: SortOption = "name-asc";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "date-asc", label: "Date modified (oldest)" },
  { value: "date-desc", label: "Date modified (newest)" },
  { value: "caption-asc", label: "Caption length (shortest)" },
  { value: "caption-desc", label: "Caption length (longest)" },
  { value: "megapixels-asc", label: "Megapixels (smallest)" },
  { value: "megapixels-desc", label: "Megapixels (largest)" },
  { value: "duration-asc", label: "Duration (shortest)" },
  { value: "duration-desc", label: "Duration (longest)" },
];

const SORT_OPTION_VALUES = new Set<SortOption>(SORT_OPTIONS.map((option) => option.value));

function isSortOption(value: string): value is SortOption {
  return SORT_OPTION_VALUES.has(value as SortOption);
}

export function parseSortOption(value: string): SortOption {
  return isSortOption(value) ? value : DEFAULT_SORT;
}

function compareNames(a: GalleryItem, b: GalleryItem): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function modifiedTimestamp(item: GalleryItem): number {
  if (!item.modified_at) return 0;
  const parsed = Date.parse(item.modified_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function captionLength(item: GalleryItem): number {
  return item.description?.length ?? 0;
}

function totalMegapixels(item: GalleryItem): number {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / 1_000_000;
}

function videoDuration(item: GalleryItem): number {
  return durationSeconds(item.duration) ?? 0;
}

type NumericSort = Exclude<SortOption, "name-asc" | "name-desc">;

const NUMERIC_SORT: Record<NumericSort, (item: GalleryItem) => number> = {
  "date-asc": modifiedTimestamp,
  "date-desc": modifiedTimestamp,
  "caption-asc": captionLength,
  "caption-desc": captionLength,
  "megapixels-asc": totalMegapixels,
  "megapixels-desc": totalMegapixels,
  "duration-asc": videoDuration,
  "duration-desc": videoDuration,
};

export function sortGalleryItems(items: GalleryItem[], sort: SortOption): GalleryItem[] {
  if (sort === "name-asc") return [...items].sort(compareNames);
  if (sort === "name-desc") return [...items].sort((a, b) => compareNames(b, a));

  const valueOf = NUMERIC_SORT[sort];
  if (!valueOf) return [...items].sort(compareNames);

  const descending = sort.endsWith("-desc");
  return items
    .map((item) => ({ item, value: valueOf(item) }))
    .sort(
      (left, right) =>
        (descending ? right.value - left.value : left.value - right.value) ||
        compareNames(left.item, right.item),
    )
    .map((entry) => entry.item);
}

function compileSearchRegex(pattern: string): RegExp | null {
  try {
    // `s` so `.` spans newlines: without it an exclusion pattern like `^((?!x).)*$`
    // rejects every multi-line caption. `m` is deliberately omitted — per-line
    // anchors would let each line satisfy a negation on its own.
    return new RegExp(pattern, "is");
  } catch {
    return null;
  }
}

function matchesSearchQuery(
  query: string,
  pattern: RegExp | null,
  useRegex: boolean,
  matchNames: boolean,
  name: string,
  description?: string | null,
): boolean {
  if (useRegex && pattern) {
    if (matchNames && pattern.test(name)) return true;
    if (description != null && pattern.test(description)) return true;
    return false;
  }

  const needle = query.toLowerCase();
  if (matchNames && name.toLowerCase().includes(needle)) return true;
  if (description?.toLowerCase().includes(needle)) return true;
  return false;
}

/**
 * `matchNames` off searches captions only. That is what makes an exclusion pattern
 * expressible: a name almost never contains the excluded word, so an OR over both
 * fields would keep every item.
 */
export function filterBySearch(
  items: GalleryItem[],
  query: string,
  regex: boolean,
  matchNames: boolean,
): GalleryItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  // Incomplete/invalid patterns must not throw while the user is still typing.
  const pattern = regex ? compileSearchRegex(trimmed) : null;

  return items.filter((item) =>
    matchesSearchQuery(trimmed, pattern, regex, matchNames, item.name, item.description),
  );
}

/** Folders carry no caption text, so only the folder name can match the search. */
export function filterSubfoldersBySearch(
  folders: Subfolder[],
  query: string,
  regex: boolean,
): Subfolder[] {
  const trimmed = query.trim();
  if (!trimmed) return folders;

  const pattern = regex ? compileSearchRegex(trimmed) : null;

  return folders.filter((folder) => matchesSearchQuery(trimmed, pattern, regex, true, folder.name));
}

export function applyItemFilter(items: GalleryItem[], filter: ItemFilter): GalleryItem[] {
  if (filter === "captioned") return items.filter((item) => item.has_description);
  if (filter === "issue") return items.filter(isResolvableIssueItem);
  if (filter === "uncaptioned") return items.filter((item) => !item.has_description);
  return items;
}

/**
 * Its own axis rather than a value of `ItemFilter`, so a file property narrows whatever
 * the caption filter already chose instead of replacing it.
 */
export function applyFileFilter(items: GalleryItem[], fileFilter: FileFilter): GalleryItem[] {
  if (fileFilter === "duplicates") return items.filter(isDuplicateItem);
  if (fileFilter === "candidates") return items.filter(isCandidateItem);
  return items;
}

/**
 * The one place a media-type filter is decided.
 *
 * `video` covers GIFs too: they carry a frame sequence and group with video for
 * training. Filtering and counting share this so a count can never disagree with
 * the grid it labels.
 */
export function matchesMediaTypeFilter(item: GalleryItem, filter: MediaTypeFilter): boolean {
  if (filter === "image") return item.media_type === "image";
  if (filter === "video") return isMotion(item);
  return true;
}

export function applyMediaTypeFilter(items: GalleryItem[], filter: MediaTypeFilter): GalleryItem[] {
  if (filter === "all") return items;
  return items.filter((item) => matchesMediaTypeFilter(item, filter));
}

export function processGalleryItems(
  items: GalleryItem[],
  options: {
    filter: ItemFilter;
    mediaTypeFilter: MediaTypeFilter;
    fileFilter: FileFilter;
    searchQuery: string;
    searchRegex: boolean;
    searchNames: boolean;
    sort: SortOption;
  },
): GalleryItem[] {
  return sortGalleryItems(
    filterBySearch(
      applyFileFilter(
        applyItemFilter(applyMediaTypeFilter(items, options.mediaTypeFilter), options.filter),
        options.fileFilter,
      ),
      options.searchQuery,
      options.searchRegex,
      options.searchNames,
    ),
    options.sort,
  );
}

function countBy<T>(items: T[], predicate: (item: T) => boolean): number {
  let count = 0;
  for (const item of items) {
    if (predicate(item)) count += 1;
  }
  return count;
}

export function countCaptioned(items: GalleryItem[]): number {
  return countBy(items, (item) => item.has_description);
}

export function countIssues(items: GalleryItem[]): number {
  return countBy(items, isResolvableIssueItem);
}

export function countMediaType(items: GalleryItem[], filter: MediaTypeFilter): number {
  return countBy(items, (item) => matchesMediaTypeFilter(item, filter));
}
