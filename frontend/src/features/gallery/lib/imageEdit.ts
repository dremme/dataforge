import {
  IDENTITY_CROP,
  isIdentityCrop,
  type CropRect,
  type Orientation,
  type RotationDegrees,
  type Size,
} from "./crop";
import { maskDraftsFromSpec, masksEqual, toMaskRegions, type MaskDraft } from "./mask";
import { autoAdjustEqual } from "./autoAdjust";
import { RESTING_ADJUST, adjustEqual, clampAdjust, isAdjustIdentity } from "./colorAdjust";
import {
  IDENTITY_EPSILON,
  MIN_SCALE,
  clamp,
  cropFromSpec,
  sameNumber,
  specCropsEqual,
} from "./editSpec";
import type { AutoAdjust, ColorAdjust, ImageEditSpec } from "@/shared/types";

// Order matches backend/image_edit.py: mask, crop, mirror, rotate, scale, adjust. Sizes round.

const QUARTER_TURNS: readonly RotationDegrees[] = [0, 90, 180, 270];

export interface ImageEditDraft {
  masks: MaskDraft[];
  crop: CropRect;
  mirrorH: boolean;
  mirrorV: boolean;
  rotate: RotationDegrees;
  scale: number;
  adjust: ColorAdjust;
  /** The wand's last reading, so its dial can rescale it; never rendered. */
  autoAdjust: AutoAdjust | null;
}

export function emptyDraft(): ImageEditDraft {
  return {
    masks: [],
    crop: IDENTITY_CROP,
    mirrorH: false,
    mirrorV: false,
    rotate: 0,
    scale: 1,
    adjust: { ...RESTING_ADJUST },
    autoAdjust: null,
  };
}

export function isIdentityEdit(draft: ImageEditDraft): boolean {
  return (
    draft.masks.length === 0 &&
    isIdentityCrop(draft.crop) &&
    !draft.mirrorH &&
    !draft.mirrorV &&
    draft.rotate === 0 &&
    Math.abs(draft.scale - 1) < IDENTITY_EPSILON &&
    isAdjustIdentity(draft.adjust)
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
    masks: toMaskRegions(draft.masks),
    crop: isIdentityCrop(draft.crop) ? null : { ...draft.crop },
    mirror_h: draft.mirrorH,
    mirror_v: draft.mirrorV,
    rotate: draft.rotate,
    scale: draft.scale,
    adjust: clampAdjust(draft.adjust),
    auto_adjust: draft.autoAdjust,
  };
}

export function draftFromSpec(spec: ImageEditSpec | null): ImageEditDraft {
  const draft = emptyDraft();
  if (!spec) return draft;

  return {
    masks: maskDraftsFromSpec(spec.masks),
    crop: cropFromSpec(spec.crop),
    mirrorH: spec.mirror_h,
    mirrorV: spec.mirror_v,
    rotate: spec.rotate,
    scale: spec.scale,
    adjust: { ...spec.adjust },
    autoAdjust: spec.auto_adjust ?? null,
  };
}

/** Compared as specs, not drafts, because toImageEditSpec already normalizes a whole-frame crop. */
export function specsEqual(a: ImageEditSpec, b: ImageEditSpec): boolean {
  return (
    masksEqual(a.masks, b.masks) &&
    specCropsEqual(a.crop, b.crop) &&
    a.mirror_h === b.mirror_h &&
    a.mirror_v === b.mirror_v &&
    a.rotate === b.rotate &&
    sameNumber(a.scale, b.scale) &&
    adjustEqual(a.adjust, b.adjust) &&
    autoAdjustEqual(a.auto_adjust ?? null, b.auto_adjust ?? null)
  );
}

export function formatRotation(rotate: RotationDegrees): string {
  return `${rotate}°`;
}
