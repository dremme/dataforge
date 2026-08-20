import { clampCrop, IDENTITY_CROP, isIdentityCrop, type CropRect, type Size } from "./crop";
import type { EditCropRect, VideoEditSpec } from "@/shared/types";

/**
 * The video editing panel's arithmetic, kept pure so the panel itself only has to draw.
 *
 * The crop rectangle's geometry lives in `./crop`, shared with the image editor. What is
 * here is what only a video has - trim, speed - plus the sizing, which is video's own
 * because of the rounding: sizes are truncated to even numbers exactly the way
 * `backend/video_edit.py` writes them into the `crop=` and `scale=` filters. That parity
 * is the whole point: the panel promises the user an output resolution before the render
 * exists, and a formula that drifts from the backend's turns that promise into a quiet
 * lie. `test_video_edit.py` asserts the same table.
 */

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;

/** Matches the lower bound `VideoEditSpec` enforces server-side. */
export const MIN_SCALE = 0.05;
export const MIN_TRIM_SECONDS = 0.1;

/** A trim that reaches this close to the end is sent as "run to the end". */
const TRIM_END_EPSILON = 1e-3;
const IDENTITY_EPSILON = 1e-9;

export interface VideoEditDraft {
  trimStart: number;
  trimEnd: number;
  crop: CropRect;
  speed: number;
  scale: number;
}

/** `trunc(value / 2) * 2` - the ffmpeg expression, in TypeScript. */
export function evenTrunc(value: number): number {
  return Math.trunc(value / 2) * 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function emptyDraft(duration: number): VideoEditDraft {
  return {
    trimStart: 0,
    trimEnd: Number.isFinite(duration) && duration > 0 ? duration : 0,
    crop: IDENTITY_CROP,
    speed: 1,
    scale: 1,
  };
}

export function isIdentityEdit(draft: VideoEditDraft, duration: number): boolean {
  return (
    draft.trimStart < TRIM_END_EPSILON &&
    draft.trimEnd >= duration - TRIM_END_EPSILON &&
    isIdentityCrop(draft.crop) &&
    Math.abs(draft.speed - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.scale - 1) < IDENTITY_EPSILON
  );
}

export function clampTrimStart(value: number, draft: VideoEditDraft, duration: number): number {
  return clamp(value, 0, Math.max(0, Math.min(draft.trimEnd, duration) - MIN_TRIM_SECONDS));
}

export function clampTrimEnd(value: number, draft: VideoEditDraft, duration: number): number {
  return clamp(value, Math.min(draft.trimStart + MIN_TRIM_SECONDS, duration), duration);
}

export function croppedSize(source: Size, crop: CropRect): Size {
  return {
    width: evenTrunc(source.width * crop.width),
    height: evenTrunc(source.height * crop.height),
  };
}

export function outputDimensions(source: Size, crop: CropRect, scale: number): Size {
  const cropped = croppedSize(source, crop);
  if (Math.abs(scale - 1) < IDENTITY_EPSILON) {
    return cropped;
  }
  return { width: evenTrunc(cropped.width * scale), height: evenTrunc(cropped.height * scale) };
}

/** The scale fraction that lands the output on ``targetWidth`` as closely as it can. */
export function scaleForTargetWidth(source: Size, crop: CropRect, targetWidth: number): number {
  const cropped = croppedSize(source, crop);
  if (cropped.width <= 0) return 1;
  return clamp(targetWidth / cropped.width, MIN_SCALE, 1);
}

/**
 * The same for a target height.
 *
 * Both axes resolve to the one `scale` the spec carries, which is what keeps the output
 * on the source's aspect: setting either dimension moves the other with it.
 */
export function scaleForTargetHeight(source: Size, crop: CropRect, targetHeight: number): number {
  const cropped = croppedSize(source, crop);
  if (cropped.height <= 0) return 1;
  return clamp(targetHeight / cropped.height, MIN_SCALE, 1);
}

export function outputDuration(draft: VideoEditDraft): number {
  return Math.max(0, draft.trimEnd - draft.trimStart) / draft.speed;
}

export function cropToPixels(crop: CropRect, source: Size): CropRect {
  return {
    x: Math.round(source.width * crop.x),
    y: Math.round(source.height * crop.y),
    width: evenTrunc(source.width * crop.width),
    height: evenTrunc(source.height * crop.height),
  };
}

export function toVideoEditSpec(draft: VideoEditDraft, duration: number): VideoEditSpec {
  const runsToTheEnd = draft.trimEnd >= duration - TRIM_END_EPSILON;
  return {
    trim_start: draft.trimStart,
    trim_end: runsToTheEnd ? null : draft.trimEnd,
    crop: isIdentityCrop(draft.crop) ? null : { ...draft.crop },
    speed: draft.speed,
    scale: draft.scale,
  };
}

export function draftFromSpec(spec: VideoEditSpec | null, duration: number): VideoEditDraft {
  const draft = emptyDraft(duration);
  if (!spec) return draft;

  return {
    trimStart: Math.min(spec.trim_start, draft.trimEnd),
    trimEnd: spec.trim_end == null ? draft.trimEnd : Math.min(spec.trim_end, draft.trimEnd),
    crop: spec.crop ? clampCrop(toCropRect(spec.crop)) : IDENTITY_CROP,
    speed: spec.speed,
    scale: spec.scale,
  };
}

function toCropRect(crop: EditCropRect): CropRect {
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < IDENTITY_EPSILON;
}

function sameCrop(a: EditCropRect | null, b: EditCropRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    sameNumber(a.x, b.x) &&
    sameNumber(a.y, b.y) &&
    sameNumber(a.width, b.width) &&
    sameNumber(a.height, b.height)
  );
}

/**
 * Whether two specs would render the same file.
 *
 * Compared as specs rather than as drafts because `toVideoEditSpec` has already
 * normalized the two ways of saying "no change" - a trim that reaches the end, and a
 * crop that is the whole frame - so this cannot report a difference the backend would
 * not see.
 */
export function specsEqual(a: VideoEditSpec, b: VideoEditSpec): boolean {
  return (
    sameNumber(a.trim_start, b.trim_start) &&
    (a.trim_end == null || b.trim_end == null
      ? a.trim_end == b.trim_end
      : sameNumber(a.trim_end, b.trim_end)) &&
    sameCrop(a.crop ?? null, b.crop ?? null) &&
    sameNumber(a.speed, b.speed) &&
    sameNumber(a.scale, b.scale)
  );
}

export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0$/, "")}x`;
}

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
