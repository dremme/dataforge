export type CaptionDiffKind = "same" | "removed" | "added";

export interface CaptionDiffSegment {
  kind: CaptionDiffKind;
  text: string;
}

/** Above this many LCS cells the changed middle is shown as one removal and one addition. */
export const WORD_DIFF_CELL_LIMIT = 250_000;

// Punctuation stands alone, so a tag list differs by tag rather than by "tag,".
const TOKEN_PATTERN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

function isBlank(token: string): boolean {
  return token.trim() === "";
}

function isChange(op: CaptionDiffSegment | undefined): boolean {
  return op !== undefined && op.kind !== "same";
}

/** Word-level diff of two captions, as runs of unchanged, removed and added text. */
export function diffCaptionWords(before: string, after: string): CaptionDiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end)) {
    end += 1;
  }

  const middleA = a.slice(start, a.length - end);
  const middleB = b.slice(start, b.length - end);
  const ops: CaptionDiffSegment[] = a.slice(0, start).map((text) => ({ kind: "same", text }));

  if ((middleA.length + 1) * (middleB.length + 1) > WORD_DIFF_CELL_LIMIT) {
    ops.push(
      { kind: "removed", text: middleA.join("") },
      { kind: "added", text: middleB.join("") },
    );
  } else {
    ops.push(...lcsOps(middleA, middleB));
  }

  for (const text of a.slice(a.length - end)) ops.push({ kind: "same", text });
  return mergeOps(ops);
}

function lcsOps(a: string[], b: string[]): CaptionDiffSegment[] {
  const width = b.length + 1;
  // lengths[i * width + j]: LCS length of a[i:] and b[j:].
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }

  const ops: CaptionDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      ops.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) ops.push({ kind: "removed", text: a[i] });
  for (; j < b.length; j += 1) ops.push({ kind: "added", text: b[j] });
  return ops;
}

/**
 * Joins token runs into segments, removals before additions. A space kept between two
 * replaced words joins the replacement, so "red dog" -> "blue cat" reads as one swap.
 */
function mergeOps(ops: CaptionDiffSegment[]): CaptionDiffSegment[] {
  const segments: CaptionDiffSegment[] = [];
  let removed = "";
  let added = "";

  const push = (kind: CaptionDiffKind, text: string) => {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };
  const flush = () => {
    push("removed", removed);
    push("added", added);
    removed = "";
    added = "";
  };

  ops.forEach((op, index) => {
    if (op.kind === "removed") removed += op.text;
    else if (op.kind === "added") added += op.text;
    else if (removed && added && isBlank(op.text) && isChange(ops[index + 1])) {
      removed += op.text;
      added += op.text;
    } else {
      flush();
      push("same", op.text);
    }
  });
  flush();
  return segments;
}

const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;

/** Words each side alone has; punctuation and whitespace do not count. */
export function countChangedWords(segments: CaptionDiffSegment[]): {
  removed: number;
  added: number;
} {
  let removed = 0;
  let added = 0;
  for (const segment of segments) {
    if (segment.kind === "same") continue;
    const words = segment.text.match(WORD_PATTERN)?.length ?? 0;
    if (segment.kind === "removed") removed += words;
    else added += words;
  }
  return { removed, added };
}
