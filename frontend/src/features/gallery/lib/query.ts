import { isResolvableIssueItem } from "./issues";
import { isDuplicateItem } from "./duplicates";
import { isMotion } from "@/features/gallery/lib/itemKind";
import type { GalleryItem, Subfolder } from "@/shared/types";

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "date-asc"
  | "date-desc"
  | "caption-asc"
  | "caption-desc"
  | "megapixels-asc"
  | "megapixels-desc";

/**
 * Named `ItemFilter` rather than `CaptionFilter`: `duplicate` is a property of the file,
 * not of its caption, so a caption-only name would have been wrong the moment it landed.
 */
export type ItemFilter = "all" | "captioned" | "issue" | "uncaptioned" | "duplicate";

/** `video` means "has motion", so it covers GIFs as well as MP4s. */
export type MediaTypeFilter = "all" | "image" | "video";

const ITEM_FILTER_VALUES = new Set<ItemFilter>([
  "all",
  "captioned",
  "issue",
  "uncaptioned",
  "duplicate",
]);

const MEDIA_TYPE_FILTER_VALUES = new Set<MediaTypeFilter>(["all", "image", "video"]);

export function isItemFilter(value: string | null): value is ItemFilter {
  return value !== null && ITEM_FILTER_VALUES.has(value as ItemFilter);
}

export function isMediaTypeFilter(value: string | null): value is MediaTypeFilter {
  return value !== null && MEDIA_TYPE_FILTER_VALUES.has(value as MediaTypeFilter);
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

export function sortGalleryItems(items: GalleryItem[], sort: SortOption): GalleryItem[] {
  const sorted = [...items];

  sorted.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return compareNames(a, b);
      case "name-desc":
        return compareNames(b, a);
      case "date-desc":
        return modifiedTimestamp(b) - modifiedTimestamp(a) || compareNames(a, b);
      case "date-asc":
        return modifiedTimestamp(a) - modifiedTimestamp(b) || compareNames(a, b);
      case "caption-desc":
        return captionLength(b) - captionLength(a) || compareNames(a, b);
      case "caption-asc":
        return captionLength(a) - captionLength(b) || compareNames(a, b);
      case "megapixels-desc":
        return totalMegapixels(b) - totalMegapixels(a) || compareNames(a, b);
      case "megapixels-asc":
        return totalMegapixels(a) - totalMegapixels(b) || compareNames(a, b);
      default:
        return compareNames(a, b);
    }
  });

  return sorted;
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
  if (filter === "duplicate") return items.filter(isDuplicateItem);
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
    searchQuery: string;
    searchRegex: boolean;
    searchNames: boolean;
    sort: SortOption;
  },
): GalleryItem[] {
  return sortGalleryItems(
    filterBySearch(
      applyItemFilter(applyMediaTypeFilter(items, options.mediaTypeFilter), options.filter),
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
