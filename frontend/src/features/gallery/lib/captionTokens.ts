import { isSysPrompt } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

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

const WORD_SEPARATOR = /[^\p{L}\p{N}']+/u;

/** Caption words worth counting: lowercased, stripped of quotes, without the stop words. */
export function tokenizeCaptionWords(caption: string): string[] {
  const words: string[] = [];

  for (const raw of caption.toLowerCase().split(WORD_SEPARATOR)) {
    const word = raw.replace(/^'+|'+$/g, "");
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    words.push(word);
  }

  return words;
}

/** Captions of real media, in folder order. The .sysprompt holds instructions, not a caption. */
export function mediaCaptions(items: GalleryItem[]): string[] {
  return items
    .filter((item) => !isSysPrompt(item) && item.caption_status === "text" && item.description)
    .map((item) => item.description as string);
}
