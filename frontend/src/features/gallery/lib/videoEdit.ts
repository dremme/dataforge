import { clampCrop, IDENTITY_CROP, isIdentityCrop, type CropRect, type Size } from "./crop";
import { maskDraftsFromSpec, masksEqual, toMaskRegions, type MaskDraft } from "./mask";
import type { EditCropRect, VideoEditSpec } from "@/shared/types";

/** Sizes even-truncate to match backend/video_edit.py crop= and scale= filters. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export const SCALE_PRESETS = [1, 0.75, 0.5, 0.25] as const;
/** 0 mutes; the rest are audio gain, capped at 2x to match backend/schemas.py. */
export const VOLUME_PRESETS = [0, 0.25, 0.5, 1, 1.5, 2] as const;

export const MIN_SCALE = 0.05;
export const MIN_TRIM_SECONDS = 0.1;

/** A trim that reaches this close to the end is sent as "run to the end". */
const TRIM_END_EPSILON = 1e-3;
const IDENTITY_EPSILON = 1e-9;

export interface VideoEditDraft {
  trimStart: number;
  trimEnd: number;
  masks: MaskDraft[];
  crop: CropRect;
  speed: number;
  scale: number;
  volume: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  hue: number;
}

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
    masks: [],
    crop: IDENTITY_CROP,
    speed: 1,
    scale: 1,
    volume: 1,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    warmth: 0,
    hue: 0,
  };
}

export function isIdentityEdit(draft: VideoEditDraft, duration: number): boolean {
  return (
    draft.trimStart < TRIM_END_EPSILON &&
    draft.trimEnd >= duration - TRIM_END_EPSILON &&
    draft.masks.length === 0 &&
    isIdentityCrop(draft.crop) &&
    Math.abs(draft.speed - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.scale - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.volume - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.brightness - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.contrast - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.saturation - 1) < IDENTITY_EPSILON &&
    Math.abs(draft.warmth) < IDENTITY_EPSILON &&
    Math.abs(draft.hue) < IDENTITY_EPSILON
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

export function scaleForTargetWidth(source: Size, crop: CropRect, targetWidth: number): number {
  const cropped = croppedSize(source, crop);
  if (cropped.width <= 0) return 1;
  return clamp(targetWidth / cropped.width, MIN_SCALE, 1);
}

export function scaleForTargetHeight(source: Size, crop: CropRect, targetHeight: number): number {
  const cropped = croppedSize(source, crop);
  if (cropped.height <= 0) return 1;
  return clamp(targetHeight / cropped.height, MIN_SCALE, 1);
}

export function outputDuration(draft: VideoEditDraft): number {
  return Math.max(0, draft.trimEnd - draft.trimStart) / draft.speed;
}

/** Where a source moment lands in the rendered file. Display only: trims stay in source seconds. */
export function outputTime(seconds: number, speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return seconds;
  return seconds / speed;
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
    masks: toMaskRegions(draft.masks),
    crop: isIdentityCrop(draft.crop) ? null : { ...draft.crop },
    speed: draft.speed,
    scale: draft.scale,
    volume: draft.volume,
    brightness: draft.brightness,
    contrast: draft.contrast,
    saturation: draft.saturation,
    warmth: draft.warmth,
    hue: draft.hue,
  };
}

export function draftFromSpec(spec: VideoEditSpec | null, duration: number): VideoEditDraft {
  const draft = emptyDraft(duration);
  if (!spec) return draft;

  return {
    trimStart: Math.min(spec.trim_start, draft.trimEnd),
    trimEnd: spec.trim_end == null ? draft.trimEnd : Math.min(spec.trim_end, draft.trimEnd),
    masks: maskDraftsFromSpec(spec.masks),
    crop: spec.crop ? clampCrop(toCropRect(spec.crop)) : IDENTITY_CROP,
    speed: spec.speed,
    scale: spec.scale,
    volume: spec.volume,
    brightness: spec.brightness,
    contrast: spec.contrast,
    saturation: spec.saturation,
    warmth: spec.warmth,
    hue: spec.hue,
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

/** Compared as specs, not drafts: toVideoEditSpec normalizes trim-to-end and full crops. */
export function specsEqual(a: VideoEditSpec, b: VideoEditSpec): boolean {
  return (
    sameNumber(a.trim_start, b.trim_start) &&
    (a.trim_end == null || b.trim_end == null
      ? a.trim_end == b.trim_end
      : sameNumber(a.trim_end, b.trim_end)) &&
    masksEqual(a.masks, b.masks) &&
    sameCrop(a.crop ?? null, b.crop ?? null) &&
    sameNumber(a.speed, b.speed) &&
    sameNumber(a.scale, b.scale) &&
    sameNumber(a.volume, b.volume) &&
    sameNumber(a.brightness, b.brightness) &&
    sameNumber(a.contrast, b.contrast) &&
    sameNumber(a.saturation, b.saturation) &&
    sameNumber(a.warmth, b.warmth) &&
    sameNumber(a.hue, b.hue)
  );
}

export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0$/, "")}x`;
}

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function formatVolume(volume: number): string {
  return volume === 0 ? "Mute" : `${Math.round(volume * 100)}%`;
}
