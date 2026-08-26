import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/**
 * One image waiting to be reviewed: what is in the dataset now, and what ComfyUI made.
 *
 * The two are paired by filename, which is the same rule the backend accepts on. A
 * candidate whose source is gone - renamed, moved, deleted since the run - is kept with
 * a null `source` rather than hidden: it is a real file taking up real space, and
 * silently dropping it would leave the staging folder filling up with no way to see why.
 */
export interface CandidateReviewEntry {
  /** The dataset image's path, which is how every candidate call names the pair. */
  path: string;
  name: string;
  source: GalleryItem | null;
  candidate: GalleryItem;
}

/** True where the candidate has nothing left to replace. */
export function isOrphanedCandidate(entry: CandidateReviewEntry): boolean {
  return entry.source === null;
}

/**
 * Mirrors `isDuplicateItem`: stated as "not a sysprompt" rather than as a list of
 * media types, so a type added later cannot silently fall out of the count.
 */
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
  const byName = new Map(items.map((item) => [item.name, item]));
  const separator = folderPath.includes("/") && !folderPath.includes("\\") ? "/" : "\\";

  return candidates.map((candidate) => ({
    path: `${folderPath}${separator}${candidate.name}`,
    name: candidate.name,
    source: byName.get(candidate.name) ?? null,
    candidate,
  }));
}

/**
 * Shape of the box both before/after panes are drawn in, as width / height.
 *
 * Taken from the *candidate*, so the processed image fills its stage exactly and the
 * original letterboxes inside the same box on the rare workflow that changes the
 * framing. The two panes have to share one box - the zoom that drives them is a pointer
 * position in percent, so differently shaped boxes would put the same percentage over
 * different parts of the two images - and any box that matches neither side has to
 * stretch or crop at least one of them.
 *
 * `loaded` is the natural size the browser reports once the candidate has decoded. It
 * wins over the listing's numbers because it is what is actually on screen, and it is
 * the only source at all when the scan could not read the dimensions. Square is the
 * last resort, held only until the first frame loads.
 */
export function candidateStageAspect(
  entry: CandidateReviewEntry,
  loaded: { width: number; height: number } | null,
): number {
  const width = loaded?.width ?? entry.candidate.width ?? 0;
  const height = loaded?.height ?? entry.candidate.height ?? 0;
  if (width <= 0 || height <= 0) return 1;
  return width / height;
}

/**
 * What a difference score means, in words.
 *
 * The backend scores the pair on a perceptual hash, so the number is already blind to
 * added sharpness and sensitive to content moving. These bands turn it into a verdict.
 *
 * They are starting guesses, not measurements. Calibrate them against real runs, and
 * expect a de-watermarking preset to sit higher than an upscale by design - a large
 * structural difference is that preset working, which is why nothing here is styled as
 * an error.
 */
export const DIFFERENCE_BANDS: readonly { max: number; label: string }[] = [
  { max: 5, label: "composition kept" },
  { max: 12, label: "noticeably changed" },
  { max: Infinity, label: "reframed" },
];

export function differenceLabel(percent: number): string {
  const band = DIFFERENCE_BANDS.find((entry) => percent < entry.max);
  // The last band is unbounded, so this only fires on NaN.
  return band?.label ?? DIFFERENCE_BANDS[DIFFERENCE_BANDS.length - 1].label;
}

/** Megapixels gained, as a multiplier, or null when either side's size is unknown. */
export function resolutionGain(entry: CandidateReviewEntry): number | null {
  const source = entry.source;
  if (!source?.width || !source.height) return null;
  if (!entry.candidate.width || !entry.candidate.height) return null;

  const before = source.width * source.height;
  if (before <= 0) return null;

  return (entry.candidate.width * entry.candidate.height) / before;
}
