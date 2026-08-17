import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/**
 * Mirrors `isResolvableIssueItem`: stated as "not a sysprompt" rather than as a list of
 * media types, so a type added later cannot silently fall out of the count.
 */
export function isDuplicateItem(item: GalleryItem): boolean {
  return item.has_duplicate_file && !isSysPrompt(item);
}

export function countDuplicates(items: GalleryItem[]): number {
  let count = 0;
  for (const item of items) {
    if (isDuplicateItem(item)) count += 1;
  }
  return count;
}

/**
 * How many distinct groups those items span.
 *
 * The resolver walks groups, so this is what its counter is scaled against - counting
 * files would promise more decisions than there are. Items whose group is missing are
 * counted once each, which is the safe direction: a group is never under-reported.
 */
export function countDuplicateGroups(items: GalleryItem[]): number {
  const groups = new Set<string>();
  let ungrouped = 0;

  for (const item of items) {
    if (!isDuplicateItem(item)) continue;
    if (item.duplicate_group) groups.add(item.duplicate_group);
    else ungrouped += 1;
  }

  return groups.size + ungrouped;
}

export type KeeperReason = "resolution" | "size" | "caption" | "name";

export interface KeeperChoice {
  path: string;
  /** Why this one leads, so the default is visible rather than magic. */
  reason: KeeperReason;
}

function pixelCount(item: GalleryItem): number {
  return (item.width ?? 0) * (item.height ?? 0);
}

/**
 * Which member of a group to pre-select as the one to keep.
 *
 * Highest resolution first, because that is the copy a re-encode or a thumbnail was
 * made *from*. Then file size, which separates two same-resolution copies at different
 * quality. Then a caption, since losing written work costs more than losing a file that
 * can be re-captioned. Name last, only so the choice is deterministic.
 *
 * Only ever a starting point - the resolver lets any member be picked instead.
 */
export function chooseKeeper(members: GalleryItem[]): KeeperChoice | null {
  if (members.length === 0) return null;

  const ranked = [...members].sort((left, right) => {
    const byPixels = pixelCount(right) - pixelCount(left);
    if (byPixels !== 0) return byPixels;

    const bySize = (right.size ?? 0) - (left.size ?? 0);
    if (bySize !== 0) return bySize;

    const byCaption = Number(right.has_description) - Number(left.has_description);
    if (byCaption !== 0) return byCaption;

    return left.name.localeCompare(right.name);
  });

  const [best, runnerUp] = ranked;
  if (runnerUp === undefined) return { path: best.path, reason: "name" };

  // Name the tie-break that actually decided it, not the first rule in the list.
  if (pixelCount(best) !== pixelCount(runnerUp)) {
    return { path: best.path, reason: "resolution" };
  }
  if ((best.size ?? 0) !== (runnerUp.size ?? 0)) {
    return { path: best.path, reason: "size" };
  }
  if (best.has_description !== runnerUp.has_description) {
    return { path: best.path, reason: "caption" };
  }
  return { path: best.path, reason: "name" };
}

export const KEEPER_REASON_LABEL: Record<KeeperReason, string> = {
  resolution: "Highest resolution",
  size: "Largest file",
  caption: "Only one with a caption",
  name: "First by name",
};
