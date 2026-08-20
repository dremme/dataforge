import {
  clampCrop,
  IDENTITY_CROP,
  isIdentityCrop,
  type CropRect,
  type Orientation,
  type RotationDegrees,
  type Size,
} from "./crop";
import type { EditCropRect, ImageEditSpec } from "@/shared/types";

/**
 * The image editing panel's arithmetic, kept pure so the panel itself only has to draw.
 *
 * The order is fixed and shared with `backend/image_edit.py`: **crop, then mirror, then
 * rotate, then scale**. Crop is measured against the source frame, which is what lets the
 * overlay hand over the rectangle it drew without undoing a rotation first; the rotation
 * then swaps the output's axes, and that swap is the only place it touches this file.
 *
 * Sizes are rounded rather than truncated to even numbers. Video truncates because
 * `yuv420p` cannot express an odd dimension; a still has no chroma plane to keep in step,
 * and Pillow is asked for exactly these numbers.
 */

export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;

/** Matches the lower bound `ImageEditSpec` enforces server-side. */
export const MIN_SCALE = 0.05;

const IDENTITY_EPSILON = 1e-9;

const QUARTER_TURNS: readonly RotationDegrees[] = [0, 90, 180, 270];

export interface ImageEditDraft {
  crop: CropRect;
  mirrorH: boolean;
  mirrorV: boolean;
  rotate: RotationDegrees;
  scale: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function emptyDraft(): ImageEditDraft {
  return { crop: IDENTITY_CROP, mirrorH: false, mirrorV: false, rotate: 0, scale: 1 };
}

export function isIdentityEdit(draft: ImageEditDraft): boolean {
  return (
    isIdentityCrop(draft.crop) &&
    !draft.mirrorH &&
    !draft.mirrorV &&
    draft.rotate === 0 &&
    Math.abs(draft.scale - 1) < IDENTITY_EPSILON
  );
}

/** Turn ``current`` by ``turns`` quarter-turns clockwise; negative turns anticlockwise. */
export function rotateBy(current: RotationDegrees, turns: number): RotationDegrees {
  const index = (QUARTER_TURNS.indexOf(current) + turns) % QUARTER_TURNS.length;
  return QUARTER_TURNS[(index + QUARTER_TURNS.length) % QUARTER_TURNS.length];
}

/** Whether a rotation puts the frame on its side, so width and height trade places. */
export function swapsAxes(rotate: RotationDegrees): boolean {
  return rotate === 90 || rotate === 270;
}

export function orientationOf(draft: ImageEditDraft): Orientation {
  return { rotate: draft.rotate, mirrorH: draft.mirrorH, mirrorV: draft.mirrorV };
}

export function croppedSize(source: Size, crop: CropRect): Size {
  return {
    width: Math.round(source.width * crop.width),
    height: Math.round(source.height * crop.height),
  };
}

/**
 * What the file will measure once the whole draft has been applied.
 *
 * Mirroring is absent on purpose: it moves pixels without moving the frame. The scale is
 * applied after the axis swap so the readout matches Pillow, which resizes last.
 */
export function outputDimensions(
  source: Size,
  crop: CropRect,
  rotate: RotationDegrees,
  scale: number,
): Size {
  const cropped = croppedSize(source, crop);
  const turned = swapsAxes(rotate)
    ? { width: cropped.height, height: cropped.width }
    : { width: cropped.width, height: cropped.height };

  if (Math.abs(scale - 1) < IDENTITY_EPSILON) {
    return turned;
  }
  return {
    width: Math.max(1, Math.round(turned.width * scale)),
    height: Math.max(1, Math.round(turned.height * scale)),
  };
}

/**
 * The scale fraction that lands the output on ``targetWidth`` as closely as it can.
 *
 * Measured against the rotated size, because that is what the W field is labelled with:
 * typing 800 into a sideways image means 800 across, not 800 down.
 */
export function scaleForTargetWidth(
  source: Size,
  crop: CropRect,
  rotate: RotationDegrees,
  targetWidth: number,
): number {
  const full = outputDimensions(source, crop, rotate, 1);
  if (full.width <= 0) return 1;
  return clamp(targetWidth / full.width, MIN_SCALE, 1);
}

/**
 * The same for a target height.
 *
 * Both axes resolve to the one `scale` the spec carries, which is what keeps the output
 * on the source's aspect: setting either dimension moves the other with it.
 */
export function scaleForTargetHeight(
  source: Size,
  crop: CropRect,
  rotate: RotationDegrees,
  targetHeight: number,
): number {
  const full = outputDimensions(source, crop, rotate, 1);
  if (full.height <= 0) return 1;
  return clamp(targetHeight / full.height, MIN_SCALE, 1);
}

export function toImageEditSpec(draft: ImageEditDraft): ImageEditSpec {
  return {
    crop: isIdentityCrop(draft.crop) ? null : { ...draft.crop },
    mirror_h: draft.mirrorH,
    mirror_v: draft.mirrorV,
    rotate: draft.rotate,
    scale: draft.scale,
  };
}

export function draftFromSpec(spec: ImageEditSpec | null): ImageEditDraft {
  const draft = emptyDraft();
  if (!spec) return draft;

  return {
    crop: spec.crop ? clampCrop(toCropRect(spec.crop)) : IDENTITY_CROP,
    mirrorH: spec.mirror_h,
    mirrorV: spec.mirror_v,
    rotate: spec.rotate,
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
 * Compared as specs rather than as drafts because `toImageEditSpec` has already
 * normalized the one way of saying "no change" - a crop that is the whole frame - so
 * this cannot report a difference the backend would not see.
 */
export function specsEqual(a: ImageEditSpec, b: ImageEditSpec): boolean {
  return (
    sameCrop(a.crop ?? null, b.crop ?? null) &&
    a.mirror_h === b.mirror_h &&
    a.mirror_v === b.mirror_v &&
    a.rotate === b.rotate &&
    sameNumber(a.scale, b.scale)
  );
}

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function formatRotation(rotate: RotationDegrees): string {
  return `${rotate}°`;
}
