import { IDENTITY_CROP, isIdentityCrop, type CropRect, type Size } from "./crop";
import { snapToFrame } from "./frameGrid";
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
import type { AutoAdjust, ColorAdjust, VideoEditSpec } from "@/shared/types";

export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4] as const;
/** 0 mutes; the rest are audio gain, capped at 2x to match backend/schemas.py. */
export const VOLUME_PRESETS = [0, 0.25, 0.5, 1, 1.5, 2] as const;

export const MIN_TRIM_SECONDS = 0.1;

/** A trim that reaches this close to the end is sent as "run to the end". */
const TRIM_END_EPSILON = 1e-3;

export interface VideoEditDraft {
  trimStart: number;
  trimEnd: number;
  masks: MaskDraft[];
  crop: CropRect;
  speed: number;
  scale: number;
  volume: number;
  adjust: ColorAdjust;
  /** The wand's last reading, so its dial can rescale it; never rendered. */
  autoAdjust: AutoAdjust | null;
}

/** Sizes even-truncate to match backend/video_edit.py crop= and scale= filters. */
export function evenTrunc(value: number): number {
  return Math.trunc(value / 2) * 2;
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
    adjust: { ...RESTING_ADJUST },
    autoAdjust: null,
  };
}

/**
 * Refits a draft to a corrected duration: an end at the old full length moves to the new one,
 * and no end may pass it. Browsers extend the duration of a stream that starts after zero once
 * they read its last frame.
 */
export function draftForDuration(
  draft: VideoEditDraft,
  previous: number,
  duration: number,
): VideoEditDraft {
  const trimEnd =
    draft.trimEnd >= previous - TRIM_END_EPSILON ? duration : Math.min(draft.trimEnd, duration);
  if (trimEnd === draft.trimEnd) return draft;
  return { ...draft, trimStart: Math.min(draft.trimStart, trimEnd), trimEnd };
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
    isAdjustIdentity(draft.adjust)
  );
}

export function clampTrimStart(value: number, draft: VideoEditDraft, duration: number): number {
  return clamp(value, 0, Math.max(0, Math.min(draft.trimEnd, duration) - MIN_TRIM_SECONDS));
}

export function clampTrimEnd(value: number, draft: VideoEditDraft, duration: number): number {
  return clamp(value, Math.min(draft.trimStart + MIN_TRIM_SECONDS, duration), duration);
}

/**
 * Trim points name frame boundaries, so a handle keeps the frame it shows. A clamp lands
 * between two, and its bound is hard, so a clamped value re-snaps inward: down here, up below.
 */
export function snapTrimStart(
  value: number,
  draft: VideoEditDraft,
  duration: number,
  frameDuration: number,
): number {
  const snapped = snapToFrame(value, frameDuration);
  const clamped = clampTrimStart(snapped, draft, duration);
  if (clamped === snapped) return snapped;
  return Math.max(0, Math.floor(clamped / frameDuration) * frameDuration);
}

export function snapTrimEnd(
  value: number,
  draft: VideoEditDraft,
  duration: number,
  frameDuration: number,
): number {
  // Full length stays exact, or snapping short of the last frame would read as a trim.
  if (value >= duration - frameDuration / 2) return duration;

  const snapped = snapToFrame(value, frameDuration);
  const clamped = clampTrimEnd(snapped, draft, duration);
  if (clamped === snapped) return snapped;
  return Math.min(duration, Math.ceil(clamped / frameDuration) * frameDuration);
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

/** Track position, shared so the playing and paused markers cannot drift apart by a pixel. */
export function trackPercent(seconds: number, duration: number): string {
  // An unusable duration spans a second: the handles sit at 0 and nothing divides by zero.
  const span = Number.isFinite(duration) && duration > 0 ? duration : 1;
  return `${(Math.min(seconds, span) / span) * 100}%`;
}

/** Where a source moment lands in the rendered file. Display only: trims stay in source seconds. */
export function outputTime(seconds: number, speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return seconds;
  return seconds / speed;
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
    adjust: clampAdjust(draft.adjust),
    auto_adjust: draft.autoAdjust,
  };
}

export function draftFromSpec(spec: VideoEditSpec | null, duration: number): VideoEditDraft {
  const draft = emptyDraft(duration);
  if (!spec) return draft;

  return {
    trimStart: Math.min(spec.trim_start, draft.trimEnd),
    trimEnd: spec.trim_end == null ? draft.trimEnd : Math.min(spec.trim_end, draft.trimEnd),
    masks: maskDraftsFromSpec(spec.masks),
    crop: cropFromSpec(spec.crop),
    speed: spec.speed,
    scale: spec.scale,
    volume: spec.volume,
    adjust: { ...spec.adjust },
    autoAdjust: spec.auto_adjust ?? null,
  };
}

/** Compared as specs, not drafts: toVideoEditSpec normalizes trim-to-end and full crops. */
export function specsEqual(a: VideoEditSpec, b: VideoEditSpec): boolean {
  return (
    sameNumber(a.trim_start, b.trim_start) &&
    (a.trim_end == null || b.trim_end == null
      ? a.trim_end == b.trim_end
      : sameNumber(a.trim_end, b.trim_end)) &&
    masksEqual(a.masks, b.masks) &&
    specCropsEqual(a.crop, b.crop) &&
    sameNumber(a.speed, b.speed) &&
    sameNumber(a.scale, b.scale) &&
    sameNumber(a.volume, b.volume) &&
    adjustEqual(a.adjust, b.adjust) &&
    autoAdjustEqual(a.auto_adjust ?? null, b.auto_adjust ?? null)
  );
}

export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0$/, "")}x`;
}

export function formatVolume(volume: number): string {
  return volume === 0 ? "Mute" : `${Math.round(volume * 100)}%`;
}
