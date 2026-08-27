const CONTEXT_CHARS = 44;
const CHANGE_CHARS = 90;

const ELLIPSIS = "…";

export interface CaptionDiff {
  prefix: string;
  removed: string;
  added: string;
  suffix: string;
}

export function diffCaption(before: string, after: string): CaptionDiff {
  const shared = Math.min(before.length, after.length);

  let start = 0;
  while (start < shared && before[start] === after[start]) start += 1;

  // Cap the suffix so overlapping repeats (before "aa" -> after "aaa") cannot claim both ends.
  let end = 0;
  while (end < shared - start && before.at(-1 - end) === after.at(-1 - end)) end += 1;

  return {
    prefix: elideStart(before.slice(0, start)),
    removed: elideEnd(before.slice(start, before.length - end), CHANGE_CHARS),
    added: elideEnd(after.slice(start, after.length - end), CHANGE_CHARS),
    suffix: elideEnd(before.slice(before.length - end), CONTEXT_CHARS),
  };
}

const WORD_BOUNDARY_SLACK = 12;

function elideStart(text: string): string {
  if (text.length <= CONTEXT_CHARS) return text;

  const tail = text.slice(-CONTEXT_CHARS);
  const space = tail.indexOf(" ");
  return ELLIPSIS + (space >= 0 && space < WORD_BOUNDARY_SLACK ? tail.slice(space) : tail);
}

function elideEnd(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const space = head.lastIndexOf(" ");
  return (space > limit - WORD_BOUNDARY_SLACK ? head.slice(0, space) : head) + ELLIPSIS;
}
