import type { VideoCropRect, VideoEditSpec } from "@/shared/types";

/**
 * The editing panel's arithmetic, kept pure so the panel itself only has to draw.
 *
 * Sizes are truncated to even numbers exactly the way `backend/video_edit.py` writes
 * them into the `crop=` and `scale=` filters. That parity is the whole point of this
 * file: the panel promises the user an output resolution before the render exists, and
 * a formula that drifts from the backend's turns that promise into a quiet lie.
 * `test_video_edit.py` asserts the same table.
 */

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;

/** Matches the lower bound `VideoEditSpec` enforces server-side. */
export const MIN_SCALE = 0.05;
export const MIN_TRIM_SECONDS = 0.1;

/** Small enough to frame tightly, large enough that the rect stays grabbable. */
export const MIN_CROP_FRACTION = 0.05;
export const CROP_NUDGE_FRACTION = 0.01;
export const CROP_NUDGE_MULTIPLIER = 5;

/** A trim that reaches this close to the end is sent as "run to the end". */
const TRIM_END_EPSILON = 1e-3;
const IDENTITY_EPSILON = 1e-9;

/** How far a rectangle may sit from a listed shape and still count as that shape. */
const ASPECT_TOLERANCE = 0.005;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoEditDraft {
  trimStart: number;
  trimEnd: number;
  crop: CropRect;
  speed: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CropAspect {
  id: string;
  label: string;
  /** Width over height, or null for a rectangle the user shapes freely. */
  ratio: number | null;
}

/** How a crop may be shaped: freely, or locked to one of these, in orientation pairs. */
export const CROP_ASPECTS: readonly CropAspect[] = [
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

export const IDENTITY_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CROP_HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const CORNER_HANDLES = new Set<CropHandle>(["nw", "ne", "se", "sw"]);

export function isCornerHandle(handle: CropHandle): boolean {
  return CORNER_HANDLES.has(handle);
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

export function isIdentityCrop(crop: CropRect): boolean {
  return (
    Math.abs(crop.x) < IDENTITY_EPSILON &&
    Math.abs(crop.y) < IDENTITY_EPSILON &&
    Math.abs(crop.width - 1) < IDENTITY_EPSILON &&
    Math.abs(crop.height - 1) < IDENTITY_EPSILON
  );
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

export function clampCrop(rect: CropRect): CropRect {
  const width = clamp(rect.width, MIN_CROP_FRACTION, 1);
  const height = clamp(rect.height, MIN_CROP_FRACTION, 1);
  return {
    width,
    height,
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
  };
}

export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return clampCrop({ ...rect, x: rect.x + dx, y: rect.y + dy });
}

/**
 * Drag one handle by (dx, dy), keeping the opposite edge or corner pinned.
 *
 * Under an aspect lock the height follows the width, which is why edge handles are not
 * offered then: an edge drag has no second axis to derive the other dimension from
 * without guessing which way the rectangle should grow.
 */
export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number | null = null,
): CropRect {
  let { x, y, width, height } = rect;

  if (handle.includes("w")) {
    const shift = clamp(dx, -x, width - MIN_CROP_FRACTION);
    x += shift;
    width -= shift;
  }
  if (handle.includes("e")) {
    width = clamp(width + dx, MIN_CROP_FRACTION, 1 - x);
  }
  if (handle.includes("n")) {
    const shift = clamp(dy, -y, height - MIN_CROP_FRACTION);
    y += shift;
    height -= shift;
  }
  if (handle.includes("s")) {
    height = clamp(height + dy, MIN_CROP_FRACTION, 1 - y);
  }

  if (ratio === null) {
    return clampCrop({ x, y, width, height });
  }

  // Aspect is expressed in the frame's own pixels, and this rectangle is in fractions of
  // it, so the caller passes a ratio already divided by the frame's aspect.
  height = clamp(width / ratio, MIN_CROP_FRACTION, 1);
  width = clamp(height * ratio, MIN_CROP_FRACTION, 1);

  if (handle.includes("n")) {
    y = rect.y + rect.height - height;
  }
  if (handle.includes("w")) {
    x = rect.x + rect.width - width;
  }

  return clampCrop({ x, y, width, height });
}

/**
 * Which of `CROP_ASPECTS` a rectangle already has, or "free" when it has none of them.
 *
 * Seeding the panel from a stored spec has to restore the shape the crop was made with,
 * not just its numbers: the rect would otherwise come back locked to nothing while
 * sitting at a locked shape, and the first handle drag would quietly break the ratio.
 * The tolerance covers the even-pixel rounding the render applies to the fractions.
 */
export function aspectIdForCrop(crop: CropRect, source: Size): string {
  const width = source.width * crop.width;
  const height = source.height * crop.height;
  if (isIdentityCrop(crop) || !(width > 0) || !(height > 0)) return "free";

  const ratio = width / height;
  const match = CROP_ASPECTS.find(
    (aspect) => aspect.ratio !== null && Math.abs(aspect.ratio - ratio) <= ASPECT_TOLERANCE * ratio,
  );
  return match?.id ?? "free";
}

/** A crop of ``ratio`` centred in the frame, as large as it will go. */
export function cropForAspect(ratio: number): CropRect {
  const width = Math.min(1, ratio);
  const height = Math.min(1, 1 / ratio);
  return clampCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
}

/**
 * The box the frame actually paints inside an `object-fit: contain` element.
 *
 * The crop overlay has to sit on the picture, not on the element: everything outside
 * this box is letterboxing, and a rect positioned against the element would be offset
 * by exactly the bars.
 */
export function containedVideoBox(
  boxWidth: number,
  boxHeight: number,
  videoWidth: number,
  videoHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (boxWidth <= 0 || boxHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
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

function toCropRect(crop: VideoCropRect): CropRect {
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < IDENTITY_EPSILON;
}

function sameCrop(a: VideoCropRect | null, b: VideoCropRect | null): boolean {
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
