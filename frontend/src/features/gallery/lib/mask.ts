import { MIN_MASK_FRACTION, clampCrop, type CropRect, type Size } from "./crop";
import type { MaskRegion } from "@/shared/types";

/** Mirrors MAX_MASK_REGIONS in backend/schemas.py, which re-validates every apply. */
export const MAX_MASK_REGIONS = 24;

/** Mirrors BLUR_RADIUS_DIVISOR in backend/image_edit.py; the preview must match the render. */
const BLUR_RADIUS_DIVISOR = 4;

export type MaskMode = MaskRegion["mode"];

export interface MaskStrength {
  id: string;
  label: string;
  value: number;
}

/** Fractions of the region's shorter side, so one strength reads the same at any region size. */
export const MASK_STRENGTHS: readonly MaskStrength[] = [
  { id: "light", label: "Light", value: 0.06 },
  { id: "medium", label: "Medium", value: 0.12 },
  { id: "strong", label: "Strong", value: 0.22 },
  { id: "max", label: "Max", value: 0.4 },
];

export const DEFAULT_MASK_MODE: MaskMode = "blur";
export const DEFAULT_MASK_STRENGTH = 0.12;

const NEW_MASK_RECT: CropRect = { x: 0.35, y: 0.35, width: 0.3, height: 0.3 };
const CASCADE_STEP = 0.05;
const CASCADE_LENGTH = 6;

const STRENGTH_EPSILON = 1e-9;

export interface MaskDraft {
  /** Client-side only, so a region survives its own rectangle changing under a drag. */
  id: string;
  rect: CropRect;
  mode: MaskMode;
  strength: number;
}

let nextMaskId = 0;

function maskId(): string {
  nextMaskId += 1;
  return `mask-${nextMaskId}`;
}

/** Stepped off the last one: a second region dropped on the same spot would look like no region. */
export function newMaskDraft(mode: MaskMode, strength: number, placed: number): MaskDraft {
  const offset = CASCADE_STEP * (placed % CASCADE_LENGTH);
  return {
    id: maskId(),
    rect: clampCrop(
      { ...NEW_MASK_RECT, x: NEW_MASK_RECT.x + offset, y: NEW_MASK_RECT.y + offset },
      MIN_MASK_FRACTION,
    ),
    mode,
    strength,
  };
}

export function toMaskRegions(masks: readonly MaskDraft[]): MaskRegion[] {
  return masks.map((mask) => ({
    x: mask.rect.x,
    y: mask.rect.y,
    width: mask.rect.width,
    height: mask.rect.height,
    mode: mask.mode,
    strength: mask.strength,
  }));
}

export function maskDraftsFromSpec(regions: readonly MaskRegion[] | undefined): MaskDraft[] {
  if (!regions) return [];

  return regions.map((region) => ({
    id: maskId(),
    rect: clampCrop(
      { x: region.x, y: region.y, width: region.width, height: region.height },
      MIN_MASK_FRACTION,
    ),
    mode: region.mode,
    strength: region.strength,
  }));
}

function sameRegion(a: MaskRegion, b: MaskRegion): boolean {
  return (
    Math.abs(a.x - b.x) < STRENGTH_EPSILON &&
    Math.abs(a.y - b.y) < STRENGTH_EPSILON &&
    Math.abs(a.width - b.width) < STRENGTH_EPSILON &&
    Math.abs(a.height - b.height) < STRENGTH_EPSILON &&
    Math.abs(a.strength - b.strength) < STRENGTH_EPSILON &&
    a.mode === b.mode
  );
}

export function masksEqual(a: readonly MaskRegion[], b: readonly MaskRegion[]): boolean {
  return a.length === b.length && a.every((region, index) => sameRegion(region, b[index]));
}

/** The region's shorter side in source pixels - what both sides measure a strength against. */
export function maskExtent(rect: CropRect, source: Size): number {
  return Math.min(rect.width * source.width, rect.height * source.height);
}

export function blurRadiusPx(mask: MaskDraft, source: Size): number {
  return Math.max(1, (mask.strength * maskExtent(mask.rect, source)) / BLUR_RADIUS_DIVISOR);
}

export function pixelBlockPx(mask: MaskDraft, source: Size): number {
  return Math.max(1, Math.round(mask.strength * maskExtent(mask.rect, source)));
}

export function modeLabel(mode: MaskMode): string {
  return mode === "pixelate" ? "Pixelate" : "Blur";
}

export function describeMasks(count: number): string {
  return count === 1 ? "1 blurred region" : `${count} blurred regions`;
}
