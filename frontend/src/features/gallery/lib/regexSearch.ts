// s so `.` spans newlines; `^((?!x).)*$` would otherwise reject multi-line captions.
// m is omitted: per-line anchors let each line satisfy a negation on its own.
export const SEARCH_REGEX_FLAGS = "is";

export function compileSearchRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, SEARCH_REGEX_FLAGS);
  } catch {
    return null;
  }
}

/**
 * Which of `texts` the pattern matches. A valid pattern can backtrack for minutes on one short
 * caption, and nothing interrupts a running `RegExp`, so the gallery runs this in a worker it can
 * terminate (`useRegexSearch`).
 */
export function matchRegexTexts(pattern: string, texts: readonly string[]): boolean[] {
  const compiled = compileSearchRegex(pattern);
  return texts.map((text) => compiled !== null && compiled.test(text));
}

/** Every string a regex search tests for `items`: names, captions and tag labels. */
export function regexSearchTexts(
  items: readonly {
    name: string;
    description?: string | null;
    tags?: readonly { label: string }[];
  }[],
): string[] {
  const texts = new Set<string>();
  for (const item of items) {
    texts.add(item.name);
    if (item.description != null) texts.add(item.description);
    for (const tag of item.tags ?? []) texts.add(tag.label);
  }
  return [...texts];
}
