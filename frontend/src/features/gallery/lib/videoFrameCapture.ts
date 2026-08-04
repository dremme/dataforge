import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import type { NotificationVariant } from "@/shared/notifications/notifications";
import type { FileImportResponse } from "@/shared/types";

/** Nudge distance for the step buttons and the slider's arrow-key increment. */
export const FRAME_STEP_SECONDS = 1 / 30;

/** Canvas JPEG quality. High enough that the frame stays usable as training data. */
export const JPEG_QUALITY = 0.95;

/** Seeking exactly to `duration` lands past the last frame and can leave `seeked` unfired. */
export const END_EPSILON = 0.001;

/** Millisecond stamp width. Seven digits carry just under three hours. */
const FRAME_STAMP_DIGITS = 7;

/**
 * The frame's position in whole milliseconds, zero-padded so names sort in playback order.
 */
export function frameTimeStamp(seconds: number): string {
  const ms = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
  return String(ms).padStart(FRAME_STAMP_DIGITS, "0");
}

/**
 * The sibling JPG a frame is written to: `sunset.mp4` at 4.5 s becomes
 * `sunset_0004500.jpg`.
 *
 * The stamp is the frame's own timestamp rather than an ordinal because nothing in
 * the browser reports a video's frame rate, and a guessed one would mislabel every
 * file. Two saves inside the same frame still collapse onto one name, so re-saving
 * a frame replaces it instead of littering the folder.
 *
 * The extension cut is guarded on `dot > 0` rather than `!== -1` so a dotfile-shaped
 * name (`.mp4`) keeps its name instead of losing it to the stamp.
 */
export function videoFrameTargetName(path: string, seconds: number): string {
  const base = pathBaseName(path);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem}_${frameTimeStamp(seconds)}.jpg`;
}

/**
 * Whether a duration can drive the slider. Rejects `NaN` (metadata has not landed),
 * `0`, and `Infinity` — streamed MP4s report the last one until the full moov parses.
 */
export function hasUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

export function clampFrameTime(time: number, duration: number): number {
  if (!hasUsableDuration(duration) || !Number.isFinite(time)) return 0;
  return Math.min(Math.max(time, 0), duration - END_EPSILON);
}

export function stepFrameTime(
  current: number,
  direction: -1 | 1,
  duration: number,
  step: number = FRAME_STEP_SECONDS,
): number {
  return clampFrameTime(current + direction * step, duration);
}

/**
 * Rounds to a step multiple so the controlled `value` sits on a boundary the range
 * input agrees with — otherwise the browser snaps the thumb away from what React rendered.
 */
export function snapFrameTime(time: number, step: number = FRAME_STEP_SECONDS): number {
  if (!Number.isFinite(time)) return 0;
  return Math.round(time / step) * step;
}

function padded(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * `M:SS.mmm`, or `H:MM:SS.mmm` past an hour. Milliseconds are shown to three places
 * because one frame at 30 fps is 33 ms, and two places would collapse adjacent frames.
 */
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

/**
 * Turns the import response into the toast the user sees.
 *
 * Classified on array emptiness rather than name matching — one file goes up, and
 * whether the backend echoes names or paths is not worth depending on. `copied` is
 * checked first so an overwrite that also reports a skip still reads as success.
 */
export function frameSaveOutcome(
  result: FileImportResponse,
  targetName: string,
): { variant: NotificationVariant; message: string } {
  if (result.copied.length > 0) {
    return { variant: "success", message: `Saved frame as ${targetName}.` };
  }
  if (result.rejected.length > 0) {
    return {
      variant: "danger",
      message: `Could not save ${targetName}: the server rejected that file.`,
    };
  }
  if (result.skipped.length > 0) {
    return {
      variant: "warning",
      message: `${targetName} was not saved - the server skipped it.`,
    };
  }
  return {
    variant: "danger",
    message: `Could not save ${targetName}: the server saved nothing.`,
  };
}
