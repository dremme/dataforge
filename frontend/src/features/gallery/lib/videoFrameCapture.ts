import { frameTargetStem } from "@/features/gallery/lib/frameCapture";
import { FALLBACK_FPS } from "@/features/gallery/lib/frameGrid";

export const FRAME_STEP_SECONDS = 1 / FALLBACK_FPS;

/** Seeking exactly to duration lands past the last frame and can leave seeked unfired. */
export const END_EPSILON = 0.001;

const FRAME_STAMP_DIGITS = 7;

export function frameTimeStamp(seconds: number): string {
  const ms = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
  return String(ms).padStart(FRAME_STAMP_DIGITS, "0");
}

/** Timestamped, not ordinal: nothing in the browser reports a video's frame rate. */
export function videoFrameTargetName(path: string, seconds: number): string {
  return `${frameTargetStem(path)}_${frameTimeStamp(seconds)}.jpg`;
}

/** Rejects NaN, 0, and Infinity — streamed MP4s report Infinity until the moov parses. */
export function hasUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/**
 * Last step-aligned time before the duration. A range input only reaches step multiples, so a
 * bare-duration max leaves the thumb short and an off-grid value splits thumb from fill.
 */
export function lastFrameTime(duration: number, step: number = FRAME_STEP_SECONDS): number {
  if (!hasUsableDuration(duration)) return 0;
  // The nudge keeps float error from flooring an exact multiple one step down.
  const steps = Math.floor((duration - END_EPSILON) / step + 1e-9);
  return Math.max(0, steps) * step;
}

export function clampFrameTime(time: number, duration: number): number {
  if (!hasUsableDuration(duration) || !Number.isFinite(time)) return 0;
  return Math.min(Math.max(time, 0), lastFrameTime(duration));
}

export function stepFrameTime(
  current: number,
  direction: -1 | 1,
  duration: number,
  step: number = FRAME_STEP_SECONDS,
): number {
  return clampFrameTime(current + direction * step, duration);
}

/** Snap to a step multiple so the range input keeps the thumb where React rendered it. */
export function snapFrameTime(time: number, step: number = FRAME_STEP_SECONDS): number {
  if (!Number.isFinite(time)) return 0;
  return Math.round(time / step) * step;
}

function padded(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** Three millisecond places: 30 fps is 33 ms a frame, and two would collapse neighbours. */
export function formatFrameTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.000";

  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const head = hours > 0 ? `${hours}:${padded(mins, 2)}` : `${mins}`;
  return `${head}:${padded(secs, 2)}.${padded(ms, 3)}`;
}
