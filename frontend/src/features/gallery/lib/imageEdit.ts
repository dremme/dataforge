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

/** Order matches backend/image_edit.py: crop, mirror, rotate, scale. Sizes round. */
export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;

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

export function rotateBy(current: RotationDegrees, turns: number): RotationDegrees {
  const index = (QUARTER_TURNS.indexOf(current) + turns) % QUARTER_TURNS.length;
  return QUARTER_TURNS[(index + QUARTER_TURNS.length) % QUARTER_TURNS.length];
}

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

/** Mirror moves pixels, not the frame. Scale follows the axis swap so it matches Pillow. */
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

/** Scale that lands the output on targetWidth, against the rotated size: W is across. */
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

/** Compared as specs, not drafts, because toImageEditSpec already normalizes a whole-frame crop. */
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
