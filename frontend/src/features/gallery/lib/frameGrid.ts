/** Assumed rate when the probe reports none; nothing in the browser reports a video's own. */
export const FALLBACK_FPS = 30;

/** Matches backend/video_edit.py: past this a probe is reading a broken header, not a rate. */
const MAX_PLAUSIBLE_FPS = 1000;

/**
 * Seconds a frame occupies. Frame `k` runs `[k * fd, (k + 1) * fd)`, so trim points are
 * boundaries and a frame is addressed by the index below it.
 */
export function frameDurationFor(frameRate: number | null | undefined): number {
  const usable =
    frameRate != null &&
    Number.isFinite(frameRate) &&
    frameRate > 0 &&
    frameRate <= MAX_PLAUSIBLE_FPS;
  return 1 / (usable ? frameRate : FALLBACK_FPS);
}

export function frameIndexAt(time: number, fd: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.floor(time / fd);
}

export function snapToFrame(time: number, fd: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.round(time / fd) * fd;
}

/** Seek target for a given frame: browsers disagree about which frame a boundary shows. */
export function midFrameTime(index: number, fd: number): number {
  return (index + 0.5) * fd;
}
