/** Ranges in `text` that match the gallery toolbar search (same rules as filterBySearch). */
export function findSearchMatchRanges(
  text: string,
  query: string,
  useRegex: boolean,
): { from: number; to: number }[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];

  if (useRegex) {
    try {
      // Flags mirror compileSearchRegex (plus `g` to walk every match).
      const pattern = new RegExp(trimmed, "gis");
      const ranges: { from: number; to: number }[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (match[0].length === 0) {
          // Zero-width match — advance to avoid an infinite loop.
          if (pattern.lastIndex === match.index) {
            pattern.lastIndex += 1;
          }
          continue;
        }
        ranges.push({ from: match.index, to: match.index + match[0].length });
      }
      return ranges;
    } catch {
      // Invalid pattern while typing — fall through to plain substring (filterBySearch).
    }
  }

  const lower = text.toLowerCase();
  const needle = trimmed.toLowerCase();
  const ranges: { from: number; to: number }[] = [];
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) break;
    ranges.push({ from: index, to: index + needle.length });
    from = index + Math.max(needle.length, 1);
  }
  return ranges;
}

/** Ranges in `text` matching any of `terms` literally, sorted and merged. */
export function findLiteralMatchRanges(
  text: string,
  terms: readonly string[],
): { from: number; to: number }[] {
  if (!text || terms.length === 0) return [];

  const found = terms.flatMap((term) => findSearchMatchRanges(text, term, false));
  if (found.length === 0) return [];

  // RangeSetBuilder rejects unsorted ranges, and two terms can overlap in the caption.
  found.sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: { from: number; to: number }[] = [];
  for (const range of found) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}
