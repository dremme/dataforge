import { mediaCaptions, tokenizeCaptionWords } from "@/features/gallery/lib/captionTokens";
import type { GalleryItem } from "@/shared/types";

export interface VocabularyEntry {
  label: string;
  count: number;
  kind: "word" | "tag";
}

const MAX_TAG_WORDS = 6;
/** A phrase used once is this file's wording, not the folder's vocabulary. */
const MIN_TAG_CAPTIONS = 2;
const VOCABULARY_LIMIT = 400;

function collectTags(caption: string, into: Map<string, number>) {
  if (!caption.includes(",")) return;

  const seen = new Set<string>();

  for (const part of caption.split(",")) {
    const tag = part.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;

    const words = tag.split(/\s+/);
    if (words.length > MAX_TAG_WORDS) continue;

    seen.add(tag);
    into.set(tag, (into.get(tag) ?? 0) + 1);
  }
}

/**
 * Words and comma-separated tags this folder's captions already use, most frequent first.
 * Tags outrank words of the same count so a tag-style dataset completes whole tags.
 */
export function buildCaptionVocabulary(items: GalleryItem[]): VocabularyEntry[] {
  const wordCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const caption of mediaCaptions(items)) {
    for (const word of tokenizeCaptionWords(caption)) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
    collectTags(caption, tagCounts);
  }

  const entries: VocabularyEntry[] = [];

  for (const [label, count] of tagCounts) {
    if (count < MIN_TAG_CAPTIONS) continue;
    entries.push({ label, count, kind: "tag" });
  }

  const tagLabels = new Set(entries.map((entry) => entry.label));

  for (const [label, count] of wordCounts) {
    if (tagLabels.has(label)) continue;
    entries.push({ label, count, kind: "word" });
  }

  return entries
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(b.kind === "tag") - Number(a.kind === "tag") ||
        a.label.localeCompare(b.label),
    )
    .slice(0, VOCABULARY_LIMIT);
}
