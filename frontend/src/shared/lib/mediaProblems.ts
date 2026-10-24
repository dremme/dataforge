/** Media that has loaded nothing this long after it was asked for is reported as stuck. */
export const MEDIA_STALL_MS = 15000;

/** Why the browser cannot show a file; the suffix says nothing about the codec inside. */
export type MediaProblemKind = "unsupported" | "decode" | "network" | "stalled" | "no-picture";

/** Short words for a placeholder box; `MEDIA_PROBLEM_EXPLANATIONS` says each in full. */
export const MEDIA_PROBLEM_LABELS: Record<MediaProblemKind, string> = {
  unsupported: "Format not supported",
  decode: "Cannot decode",
  network: "Cannot read file",
  stalled: "Not loading",
  "no-picture": "No picture",
};

export const MEDIA_PROBLEM_EXPLANATIONS: Record<MediaProblemKind, string> = {
  unsupported: "This browser cannot play its format or codec.",
  decode: "The browser could not decode it; the file may be damaged or use an unsupported profile.",
  network: "The file could not be read from the server.",
  stalled: `Nothing loaded after ${MEDIA_STALL_MS / 1000} seconds; the browser may not support its codec.`,
  "no-picture": "The browser found sound in it but no picture it can decode.",
};

/** ``MediaError`` codes, spelled out: the constructor is missing outside browsers. */
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;

export function problemFromError(error: Pick<MediaError, "code"> | null): MediaProblemKind {
  if (error?.code === MEDIA_ERR_NETWORK) return "network";
  if (error?.code === MEDIA_ERR_DECODE) return "decode";
  return "unsupported";
}

/** A re-encode can fix every problem but a file the server could not read. */
export function canTranscodeAway(problem: MediaProblemKind): boolean {
  return problem !== "network";
}
