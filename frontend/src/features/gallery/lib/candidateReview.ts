import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/** Paired by the source's `candidate_name`. A gone source stays null, or staging fills silently. */
export interface CandidateReviewEntry {
  path: string;
  name: string;
  source: GalleryItem | null;
  candidate: GalleryItem;
}

export function isOrphanedCandidate(entry: CandidateReviewEntry): boolean {
  return entry.source === null;
}

/** Not a sysprompt, so a media type added later cannot fall out of the count. */
export function isCandidateItem(item: GalleryItem): boolean {
  return item.has_candidate && !isSysPrompt(item);
}

export function countCandidates(items: GalleryItem[]): number {
  let count = 0;
  for (const item of items) {
    if (isCandidateItem(item)) count += 1;
  }
  return count;
}

export function buildCandidateReviewQueue(
  folderPath: string,
  items: readonly GalleryItem[],
  candidates: readonly GalleryItem[],
): CandidateReviewEntry[] {
  const byCandidateName = new Map(
    items.flatMap((item) => (item.candidate_name ? [[item.candidate_name, item] as const] : [])),
  );
  const separator = folderPath.includes("/") && !folderPath.includes("\\") ? "/" : "\\";

  return candidates.map((candidate) => {
    const source = byCandidateName.get(candidate.name) ?? null;
    return {
      // The settle endpoints are keyed by the dataset image, never by what sits in staging.
      path: source?.path ?? `${folderPath}${separator}${candidate.name}`,
      name: source?.name ?? candidate.name,
      source,
      candidate,
    };
  });
}

/** Shared pane aspect from the candidate (loaded size wins), or one zoom shows two crops. */
export function candidateStageAspect(
  entry: CandidateReviewEntry,
  loaded: { width: number; height: number } | null,
): number {
  const width = loaded?.width ?? entry.candidate.width ?? 0;
  const height = loaded?.height ?? entry.candidate.height ?? 0;
  if (width <= 0 || height <= 0) return 1;
  return width / height;
}

export const DIFFERENCE_BANDS: readonly { max: number; label: string }[] = [
  { max: 5, label: "composition kept" },
  { max: 12, label: "noticeably changed" },
  { max: Infinity, label: "reframed" },
];

export function differenceLabel(percent: number): string {
  const band = DIFFERENCE_BANDS.find((entry) => percent < entry.max);
  // Last band is unbounded, so this only fires on NaN.
  return band?.label ?? DIFFERENCE_BANDS[DIFFERENCE_BANDS.length - 1].label;
}

export function resolutionGain(entry: CandidateReviewEntry): number | null {
  const source = entry.source;
  if (!source?.width || !source.height) return null;
  if (!entry.candidate.width || !entry.candidate.height) return null;

  const before = source.width * source.height;
  if (before <= 0) return null;

  return (entry.candidate.width * entry.candidate.height) / before;
}
