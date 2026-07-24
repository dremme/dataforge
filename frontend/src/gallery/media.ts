import { isResolvableIssueItem } from "./issues";
import type { GalleryItem } from "../types";

export type SortOption =
  | "name-asc"
  | "name-desc"
  | "date-asc"
  | "date-desc"
  | "caption-asc"
  | "caption-desc"
  | "megapixels-asc"
  | "megapixels-desc";

export type CaptionFilter = "all" | "captioned" | "issue" | "uncaptioned";

export type MediaTypeFilter = "all" | "image" | "video";

const CAPTION_FILTER_VALUES = new Set<CaptionFilter>(["all", "captioned", "issue", "uncaptioned"]);

const MEDIA_TYPE_FILTER_VALUES = new Set<MediaTypeFilter>(["all", "image", "video"]);

export function isCaptionFilter(value: string | null): value is CaptionFilter {
  return value !== null && CAPTION_FILTER_VALUES.has(value as CaptionFilter);
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

export function isSortOption(value: string): value is SortOption {
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

function matchesSearchQuery(
  query: string,
  regex: boolean,
  name: string,
  description?: string | null,
): boolean {
  const needle = query.toLowerCase();
  if (regex) {
    if (name.toLowerCase().match(needle)) return true;
    if (description?.toLowerCase().match(needle)) return true;
  }
  if (name.toLowerCase().includes(needle)) return true;
  if (description?.toLowerCase().includes(needle)) return true;
  return false;
}

export function filterBySearch(items: GalleryItem[], query: string, regex: boolean): GalleryItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  return items.filter((item) => matchesSearchQuery(trimmed, regex, item.name, item.description));
}

export function applyCaptionFilter(items: GalleryItem[], filter: CaptionFilter): GalleryItem[] {
  if (filter === "captioned") return items.filter((item) => item.has_description);
  if (filter === "issue") return items.filter(isResolvableIssueItem);
  if (filter === "uncaptioned") return items.filter((item) => !item.has_description);
  return items;
}

export function applyMediaTypeFilter(items: GalleryItem[], filter: MediaTypeFilter): GalleryItem[] {
  if (filter === "image") return items.filter((item) => item.media_type === "image");
  if (filter === "video") return items.filter((item) => item.media_type === "video");
  return items;
}

export function processGalleryItems(
  items: GalleryItem[],
  options: {
    filter: CaptionFilter;
    mediaTypeFilter: MediaTypeFilter;
    searchQuery: string;
    searchRegex: boolean;
    sort: SortOption;
  },
): GalleryItem[] {
  return sortGalleryItems(
    filterBySearch(
      applyCaptionFilter(applyMediaTypeFilter(items, options.mediaTypeFilter), options.filter),
      options.searchQuery,
      options.searchRegex,
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

export function countMediaType(items: GalleryItem[], mediaType: "image" | "video"): number {
  return countBy(items, (item) => item.media_type === mediaType);
}
