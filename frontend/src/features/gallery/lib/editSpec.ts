import { clampCrop, IDENTITY_CROP, type CropRect } from "./crop";
import type { EditCropRect, SizeFit } from "@/shared/types";

/** What the image and video specs share: the scale presets and the crop's wire form. */

export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;

export const MIN_SCALE = 0.05;

export const IDENTITY_EPSILON = 1e-9;

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < IDENTITY_EPSILON;
}

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function cropFromSpec(crop: EditCropRect | null | undefined): CropRect {
  return crop
    ? clampCrop({ x: crop.x, y: crop.y, width: crop.width, height: crop.height })
    : IDENTITY_CROP;
}

export function sizeFitsEqual(
  a: SizeFit | null | undefined,
  b: SizeFit | null | undefined,
): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return sameNumber(a.megapixels, b.megapixels) && a.multiple === b.multiple;
}

export function specCropsEqual(
  a: EditCropRect | null | undefined,
  b: EditCropRect | null | undefined,
): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return (
    sameNumber(a.x, b.x) &&
    sameNumber(a.y, b.y) &&
    sameNumber(a.width, b.width) &&
    sameNumber(a.height, b.height)
  );
}
