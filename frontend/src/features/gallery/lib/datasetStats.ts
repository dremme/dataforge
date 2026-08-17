/**
 * What a folder looks like as training data, derived entirely in the browser.
 *
 * Every input is already on the gallery item - `description` carries the full caption
 * text, not a truncation - so this needs no endpoint of its own and costs nothing the
 * folder listing has not already paid for.
 */

import { isGif, isSysPrompt, isVideo } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

/** Words too common to say anything about a dataset. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "her",
  "him",
  "his",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "there",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const TOP_WORD_LIMIT = 15;

/** Upper bound of each megapixel bucket; anything larger lands in the last one. */
const MEGAPIXEL_BUCKETS = [
  { label: "< 0.3 MP", max: 0.3 },
  { label: "0.3 – 0.5 MP", max: 0.5 },
  { label: "0.5 – 1 MP", max: 1 },
  { label: "1 – 2 MP", max: 2 },
  { label: "> 2 MP", max: Number.POSITIVE_INFINITY },
] as const;

/** Upper bound of each caption-length bucket, in characters. */
const LENGTH_BUCKETS = [
  { label: "< 250", max: 250 },
  { label: "250 – 400", max: 400 },
  { label: "400 – 600", max: 600 },
  { label: "600 – 800", max: 800 },
  { label: "800 – 1000", max: 1000 },
  { label: "> 1000", max: Number.POSITIVE_INFINITY },
] as const;

export interface StatBucket {
  label: string;
  count: number;
}

export interface WordCount {
  word: string;
  count: number;
}

export interface CaptionLengthStats {
  min: number;
  median: number;
  max: number;
  buckets: StatBucket[];
}

/**
 * What the folder needs before it is worth training on.
 *
 * Named counts rather than a labelled list: these used to be rows of filter buttons,
 * and the labels were their display text. Nothing renders them as a list any more, so
 * reading them back out by matching on a display string would be a trap the next
 * wording change springs.
 */
export interface DatasetFindings {
  captioned: number;
  missingCaption: number;
  /** Files carrying a caption issue from verify-captions. */
  captionIssues: number;
  /** Files in a duplicate group. */
  duplicates: number;
  /** How many groups those files span, which is what the resolver walks. */
  duplicateGroups: number;
}

export interface DatasetStats {
  /** Media files only; the .sysprompt is not part of the dataset. */
  total: number;
  findings: DatasetFindings;
  captionLength: CaptionLengthStats | null;
  topWords: WordCount[];
  mediaTypes: StatBucket[];
  megapixels: StatBucket[];
  /** Files whose dimensions are unknown, e.g. every non-MP4-family video. */
  unknownResolution: number;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function bucketize(values: number[], buckets: ReadonlyArray<{ label: string; max: number }>) {
  const counts = buckets.map((bucket) => ({ label: bucket.label, count: 0 }));
  for (const value of values) {
    const index = buckets.findIndex((bucket) => value < bucket.max);
    counts[index === -1 ? counts.length - 1 : index].count += 1;
  }
  return counts;
}

function countWords(captions: string[]): WordCount[] {
  const counts = new Map<string, number>();

  for (const caption of captions) {
    // Split on anything that is not a letter, digit, or intra-word apostrophe, so
    // punctuation and the comma-separated tag style both tokenize the same way.
    for (const raw of caption.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
      const word = raw.replace(/^'+|'+$/g, "");
      if (word.length < 2 || STOP_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, TOP_WORD_LIMIT);
}

export function computeDatasetStats(items: GalleryItem[]): DatasetStats {
  // The .sysprompt carries captioning instructions in its description; counting it
  // would report the instructions as if they were a caption.
  const media = items.filter((item) => !isSysPrompt(item));

  const captions: string[] = [];
  const lengths: number[] = [];
  const megapixels: number[] = [];
  let captioned = 0;
  let issues = 0;
  let duplicates = 0;
  // Group ids, so a folder with one four-way match reports one group rather than four.
  const duplicateGroups = new Set<string>();
  let ungroupedDuplicates = 0;
  let images = 0;
  let videos = 0;
  let gifs = 0;
  let unknownResolution = 0;

  for (const item of media) {
    if (item.has_issue_file) issues += 1;

    if (item.has_duplicate_file) {
      duplicates += 1;
      // A flagged file with no group id counts as a group of its own - the safe
      // direction, since a group is then never under-reported.
      if (item.duplicate_group) duplicateGroups.add(item.duplicate_group);
      else ungroupedDuplicates += 1;
    }

    if (item.caption_status === "text" && item.description) {
      captioned += 1;
      captions.push(item.description);
      lengths.push(item.description.length);
    }

    if (isGif(item)) gifs += 1;
    else if (isVideo(item)) videos += 1;
    else images += 1;

    const width = item.width ?? 0;
    const height = item.height ?? 0;
    if (width > 0 && height > 0) megapixels.push((width * height) / 1_000_000);
    else unknownResolution += 1;
  }

  const sortedLengths = [...lengths].sort((a, b) => a - b);

  return {
    total: media.length,
    findings: {
      captioned,
      missingCaption: media.length - captioned,
      captionIssues: issues,
      duplicates,
      duplicateGroups: duplicateGroups.size + ungroupedDuplicates,
    },
    captionLength:
      sortedLengths.length === 0
        ? null
        : {
            min: sortedLengths[0],
            median: median(sortedLengths),
            max: sortedLengths[sortedLengths.length - 1],
            buckets: bucketize(sortedLengths, LENGTH_BUCKETS),
          },
    topWords: countWords(captions),
    mediaTypes: [
      { label: "Images", count: images },
      { label: "Videos", count: videos },
      { label: "GIFs", count: gifs },
    ],
    megapixels: bucketize(megapixels, MEGAPIXEL_BUCKETS),
    unknownResolution,
  };
}
