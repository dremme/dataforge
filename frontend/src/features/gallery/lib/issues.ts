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

// Sidecars predating the straight-quote prompt still carry typographic quotes.
const FIRST_QUOTED_SPAN = /["“”„‟]([^"“”„‟]+)["“”„‟]/;

/**
 * The caption wording each fix flags. Only the first quoted span counts: `Replace "x"
 * with "y"` quotes the replacement second, which the caption may already contain.
 */
export function flaggedCaptionPhrases(fixes: readonly string[]): string[] {
  const phrases: string[] = [];
  const seen = new Set<string>();

  for (const fix of fixes) {
    const phrase = FIRST_QUOTED_SPAN.exec(fix)?.[1]?.trim();
    if (!phrase) continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }

  return phrases;
}
