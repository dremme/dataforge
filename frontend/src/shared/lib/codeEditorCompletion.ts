import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { VocabularyEntry } from "@/features/gallery/lib/captionVocabulary";

const MIN_PREFIX_LENGTH = 2;
const MAX_OPTIONS = 12;
/** Everything since the last comma: a tag spans the spaces inside it. */
const TAG_SEGMENT = /[^,\n]*$/u;
const WORD_PREFIX = /[\p{L}\p{N}'-]+$/u;
const VALID_FOR = /^[\p{L}\p{N}' -]*$/u;

interface Candidate {
  typed: string;
  to: number;
}

function optionsFor(entries: readonly VocabularyEntry[], typed: string) {
  const needle = typed.toLowerCase();

  return entries
    .filter((entry) => entry.label.startsWith(needle) && entry.label !== needle)
    .slice(0, MAX_OPTIONS)
    .map((entry) => ({
      label: entry.label,
      detail: String(entry.count),
      type: entry.kind === "tag" ? "constant" : "text",
      boost: Math.log1p(entry.count),
    }));
}

/** The whole tag first, then the last word alone: prose only ever matches on the word. */
function candidatesBefore(context: CompletionContext): Candidate[] {
  const candidates: Candidate[] = [];

  const tagMatch = context.matchBefore(TAG_SEGMENT);
  if (tagMatch) {
    const typed = tagMatch.text.replace(/^\s+/, "");
    if (typed) candidates.push({ typed, to: tagMatch.to });
  }

  const wordMatch = context.matchBefore(WORD_PREFIX);
  if (wordMatch && wordMatch.text !== candidates[0]?.typed) {
    candidates.push({ typed: wordMatch.text, to: wordMatch.to });
  }

  return candidates;
}

/** Completes from captions this folder already has. An explicit request accepts a short prefix. */
export function captionCompletionSource(entries: readonly VocabularyEntry[]) {
  return (context: CompletionContext): CompletionResult | null => {
    for (const candidate of candidatesBefore(context)) {
      if (!context.explicit && candidate.typed.length < MIN_PREFIX_LENGTH) continue;

      const options = optionsFor(entries, candidate.typed);
      if (options.length === 0) continue;

      return {
        from: candidate.to - candidate.typed.length,
        options,
        validFor: VALID_FOR,
      };
    }

    return null;
  };
}

export function vocabularyCompletion(entries: readonly VocabularyEntry[]): Extension {
  return autocompletion({
    override: [captionCompletionSource(entries)],
    activateOnTyping: true,
    closeOnBlur: true,
    icons: false,
    maxRenderedOptions: MAX_OPTIONS,
  });
}
