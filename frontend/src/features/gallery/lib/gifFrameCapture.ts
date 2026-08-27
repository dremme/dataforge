import { frameTargetStem } from "@/features/gallery/lib/frameCapture";

const FRAME_INDEX_DIGITS = 4;

/**
 * Indexed, not time-stamped: delay stamps collapse zero-delay frames onto one filename.
 * The `_f` prefix also keeps clip.gif and clip.mp4 from colliding.
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

export function formatFrameOrdinal(index: number, frameCount: number): string {
  if (frameCount <= 0) return "0";
  return String(clampFrameIndex(index, frameCount) + 1);
}
