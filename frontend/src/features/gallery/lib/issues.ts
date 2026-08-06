import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/**
 * Stated as "not a sysprompt" rather than as a list of media types on purpose: an
 * allowlist silently drops every type added later out of the resolver queue and
 * the issue count, with nothing failing to show for it.
 */
export function isResolvableIssueItem(item: GalleryItem): boolean {
  return item.has_issue_file && !isSysPrompt(item);
}

export function listResolvableIssueItems(items: GalleryItem[]): GalleryItem[] {
  return items.filter(isResolvableIssueItem);
}

export function countResolvableIssues(items: GalleryItem[]): number {
  return listResolvableIssueItems(items).length;
}
