import { frameTargetStem } from "@/features/gallery/lib/frameCapture";

/** Frame-index width. Four digits carry a longer animation than a GIF ever holds. */
const FRAME_INDEX_DIGITS = 4;

/**
 * The sibling JPG a GIF frame is written to: `loop.gif` frame 7 becomes
 * `loop_f0007.jpg`.
 *
 * Indexed rather than time-stamped like the video path, which stamps milliseconds
 * only because nothing in the browser reports a video's frame rate. A GIF's frame
 * index *is* its identity, and stamping accumulated delays instead would collapse
 * adjacent zero-delay frames onto one filename and silently overwrite. The `_f`
 * prefix also keeps `clip.gif` and `clip.mp4` in one folder from ever colliding.
 */
export function gifFrameTargetName(path: string, index: number): string {
  const safe = Number.isFinite(index) ? Math.max(0, Math.round(index)) : 0;
  const stamp = String(safe).padStart(FRAME_INDEX_DIGITS, "0");
  return `${frameTargetStem(path)}_f${stamp}.jpg`;
}

export function clampFrameIndex(index: number, frameCount: number): number {
  if (!Number.isFinite(index) || frameCount <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), frameCount - 1);
}

export function stepFrameIndex(current: number, direction: -1 | 1, frameCount: number): number {
  return clampFrameIndex(current + direction, frameCount);
}

/** `7 / 24` reads one-based, because a scrubber that starts at frame 0 confuses. */
export function formatFrameOrdinal(index: number, frameCount: number): string {
  if (frameCount <= 0) return "0";
  return String(clampFrameIndex(index, frameCount) + 1);
}
