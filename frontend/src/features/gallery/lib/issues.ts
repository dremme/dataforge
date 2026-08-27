import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/** Not a sysprompt, so a media type added later cannot fall out of the count. */
export function isResolvableIssueItem(item: GalleryItem): boolean {
  return item.has_issue_file && !isSysPrompt(item);
}

export function listResolvableIssueItems(items: GalleryItem[]): GalleryItem[] {
  return items.filter(isResolvableIssueItem);
}

export function countResolvableIssues(items: GalleryItem[]): number {
  return listResolvableIssueItems(items).length;
}
