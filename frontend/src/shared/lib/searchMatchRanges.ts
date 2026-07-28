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
      const pattern = new RegExp(trimmed, "gi");
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
