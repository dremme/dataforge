import type { GalleryItem } from "../types";

export function isResolvableIssueItem(item: GalleryItem): boolean {
  return item.has_issue_file && (item.media_type === "image" || item.media_type === "video");
}

export function listResolvableIssueItems(items: GalleryItem[]): GalleryItem[] {
  return items.filter(isResolvableIssueItem);
}

export function countResolvableIssues(items: GalleryItem[]): number {
  return listResolvableIssueItems(items).length;
}
