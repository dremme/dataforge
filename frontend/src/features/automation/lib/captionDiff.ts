/**
 * Reduces a before/after caption pair to the span that actually changed.
 *
 * The preview cannot re-run the match itself: the backend edits with Python's
 * regular expressions, and locating the match in JavaScript would highlight a
 * span the job never touched. Comparing the two strings the backend already
 * returned sidesteps the engine entirely - a common prefix and a common suffix
 * bracket the edit no matter which pattern produced it.
 *
 * Several scattered replacements collapse into one wide span rather than being
 * highlighted individually. That reads as "this region changed", which is still
 * true; it is never a span that stayed the same.
 */

/** Characters of untouched caption kept on each side of the change. */
const CONTEXT_CHARS = 44;

/** Characters of the changed text itself shown before it is elided. */
const CHANGE_CHARS = 90;

const ELLIPSIS = "…";

export interface CaptionDiff {
  /** Untouched text before the change, elided from the left. */
  prefix: string;
  /** Text the edit takes out, empty for a pure insertion. */
  removed: string;
  /** Text the edit puts in, empty for a pure deletion. */
  added: string;
  /** Untouched text after the change, elided from the right. */
  suffix: string;
}

/** The changed span of `before` -> `after`, with the surrounding caption trimmed to context. */
export function diffCaption(before: string, after: string): CaptionDiff {
  const shared = Math.min(before.length, after.length);

  let start = 0;
  while (start < shared && before[start] === after[start]) start += 1;

  // Bounded by what the prefix left over, so the two halves cannot overlap on a
  // repeated character (before "aa" -> after "aaa" must not claim both ends).
  let end = 0;
  while (end < shared - start && before.at(-1 - end) === after.at(-1 - end)) end += 1;

  return {
    prefix: elideStart(before.slice(0, start)),
    removed: elideEnd(before.slice(start, before.length - end), CHANGE_CHARS),
    added: elideEnd(after.slice(start, after.length - end), CHANGE_CHARS),
    suffix: elideEnd(before.slice(before.length - end), CONTEXT_CHARS),
  };
}

/** How far from the cut a word boundary may be before the elision ignores it. */
const WORD_BOUNDARY_SLACK = 12;

/** Keeps the tail of `text`, cutting at a word boundary where one is close by. */
function elideStart(text: string): string {
  if (text.length <= CONTEXT_CHARS) return text;

  const tail = text.slice(-CONTEXT_CHARS);
  const space = tail.indexOf(" ");
  return ELLIPSIS + (space >= 0 && space < WORD_BOUNDARY_SLACK ? tail.slice(space) : tail);
}

/** Keeps the head of `text`, cutting at a word boundary where one is close by. */
function elideEnd(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const space = head.lastIndexOf(" ");
  return (space > limit - WORD_BOUNDARY_SLACK ? head.slice(0, space) : head) + ELLIPSIS;
}
