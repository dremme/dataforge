import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { NotifyOptions } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

/** Not a sysprompt, so a media type added later cannot fall out of the count. */
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

/** Distinct groups the resolver walks. Missing ids count once so none is under-reported. */
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
  reason: KeeperReason;
}

function pixelCount(item: GalleryItem): number {
  return (item.width ?? 0) * (item.height ?? 0);
}

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

export function duplicateOpenOutcome(staleCount: number, groupCount: number): NotifyOptions | null {
  if (groupCount > 0) return null;

  if (staleCount > 0) {
    const one = staleCount === 1;
    const findings = `${staleCount} duplicate ${one ? "finding has" : "findings have"}`;
    return {
      variant: "warning",
      message: `${findings} no partner left to compare. Re-run find duplicates to rebuild ${
        one ? "it" : "them"
      }.`,
    };
  }

  return { variant: "warning", message: "No duplicate groups left in this folder." };
}
