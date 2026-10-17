import { VIDEO_PROJECT_DUCK_RAMP_SECONDS } from "@/shared/constants";
import type {
  VideoProjectEasing,
  VideoProjectKeyframe,
  VideoProjectKeyframes,
} from "@/shared/types";
import type { Clip } from "./timeline";

/**
 * The preview's half of `video_project_animation.py`. Keyframe times are timeline seconds from
 * the clip's start; a property with keyframes ignores its static value.
 */

export type AnimatedProperty = keyof VideoProjectKeyframes;
export type TransformProperty = Exclude<AnimatedProperty, "gain">;

export const EASINGS: { value: VideoProjectEasing; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "ease_in", label: "Ease in" },
  { value: "ease_out", label: "Ease out" },
  { value: "ease_in_out", label: "Ease in and out" },
  { value: "hold", label: "Hold" },
];

export function noKeyframes(): VideoProjectKeyframes {
  return { x: [], y: [], scale: [], rotation: [], opacity: [], gain: [] };
}

export function ease(easing: VideoProjectEasing, progress: number): number {
  const u = Math.min(1, Math.max(0, progress));
  if (easing === "ease_in") return u * u;
  if (easing === "ease_out") return u * (2 - u);
  if (easing === "ease_in_out") return u * u * (3 - 2 * u);
  if (easing === "hold") return 0;
  return u;
}

export function keyframeValue(
  keys: readonly VideoProjectKeyframe[],
  time: number,
  fallback: number,
): number {
  if (keys.length === 0) return fallback;
  if (time <= keys[0].time) return keys[0].value;
  for (let index = 0; index + 1 < keys.length; index += 1) {
    const before = keys[index];
    const after = keys[index + 1];
    if (time < after.time) {
      const progress = (time - before.time) / (after.time - before.time);
      return before.value + (after.value - before.value) * ease(before.easing, progress);
    }
  }
  return keys[keys.length - 1].value;
}

function staticValue(clip: Clip, property: AnimatedProperty): number {
  return property === "gain" ? clip.gain : clip.transform[property];
}

/** ``property`` at ``time`` on the timeline. */
export function clipValueAt(clip: Clip, property: AnimatedProperty, time: number): number {
  return keyframeValue(clip.keyframes[property], time - clip.start, staticValue(clip, property));
}

export function transformAt(clip: Clip, time: number): Clip["transform"] {
  return {
    x: clipValueAt(clip, "x", time),
    y: clipValueAt(clip, "y", time),
    scale: clipValueAt(clip, "scale", time),
    rotation: clipValueAt(clip, "rotation", time),
    opacity: clipValueAt(clip, "opacity", time),
  };
}

/** Two keyframes closer than this are one: half a frame at the fastest rate a project takes. */
const SAME_KEY_SECONDS = 1 / 240;

/** The keyframe of ``property`` at the playhead, if one sits there. */
export function keyframeAt(
  clip: Clip,
  property: AnimatedProperty,
  time: number,
): VideoProjectKeyframe | undefined {
  const local = time - clip.start;
  return clip.keyframes[property].find((key) => Math.abs(key.time - local) < SAME_KEY_SECONDS);
}

function withKeys(clip: Clip, property: AnimatedProperty, keys: VideoProjectKeyframe[]): Clip {
  return { ...clip, keyframes: { ...clip.keyframes, [property]: keys } };
}

function withStatic(clip: Clip, property: AnimatedProperty, value: number): Clip {
  return property === "gain"
    ? { ...clip, gain: value }
    : { ...clip, transform: { ...clip.transform, [property]: value } };
}

/**
 * The patch a control sets: an animated property gets a keyframe at the playhead, or that one
 * changed; one that is not animated changes its static value.
 */
export function setValueAt(
  clip: Clip,
  property: AnimatedProperty,
  time: number,
  value: number,
): Partial<Clip> {
  const keys = clip.keyframes[property];
  if (keys.length === 0) {
    const next = withStatic(clip, property, value);
    return property === "gain" ? { gain: next.gain } : { transform: next.transform };
  }
  return { keyframes: upsert(clip, property, time, value).keyframes };
}

function upsert(clip: Clip, property: AnimatedProperty, time: number, value: number): Clip {
  const local = time - clip.start;
  const keys = clip.keyframes[property];
  const existing = keyframeAt(clip, property, time);
  const next = existing
    ? keys.map((key) => (key === existing ? { ...key, value } : key))
    : [...keys, { time: local, value, easing: "linear" as const }].sort((a, b) => a.time - b.time);
  return withKeys(clip, property, next);
}

export const TRANSFORM_PROPERTIES: TransformProperty[] = ["x", "y", "scale", "rotation", "opacity"];

/** A whole transform set at ``time``, as by a drag in the monitor: only what changed is keyed. */
export function transformPatchAt(clip: Clip, time: number, next: Clip["transform"]): Partial<Clip> {
  let current = clip;
  for (const property of TRANSFORM_PROPERTIES) {
    if (Math.abs(next[property] - clipValueAt(clip, property, time)) < 1e-9) continue;
    current = { ...current, ...setValueAt(current, property, time, next[property]) };
  }
  return { transform: current.transform, keyframes: current.keyframes };
}

/**
 * Adds a keyframe holding the value shown at the playhead, or removes the one there. Removing the
 * last one leaves the property still at that value, so nothing jumps.
 */
export function toggleKeyframe(clip: Clip, property: AnimatedProperty, time: number): Clip {
  const value = clipValueAt(clip, property, time);
  const existing = keyframeAt(clip, property, time);
  if (!existing) return upsert(clip, property, time, value);
  const keys = clip.keyframes[property].filter((key) => key !== existing);
  return withStatic(
    withKeys(clip, property, keys),
    property,
    keys.length ? staticValue(clip, property) : value,
  );
}

export function setKeyframeEasing(
  clip: Clip,
  property: AnimatedProperty,
  time: number,
  easing: VideoProjectEasing,
): Clip {
  const existing = keyframeAt(clip, property, time);
  if (!existing) return clip;
  return withKeys(
    clip,
    property,
    clip.keyframes[property].map((key) => (key === existing ? { ...key, easing } : key)),
  );
}

/** Timeline times of the property's keyframes that lie on the clip, for stepping between them. */
export function keyframeTimes(clip: Clip, properties: readonly AnimatedProperty[]): number[] {
  const times = new Set<number>();
  for (const property of properties) {
    for (const key of clip.keyframes[property]) {
      if (key.time >= -SAME_KEY_SECONDS && key.time <= clip.duration + SAME_KEY_SECONDS)
        times.add(clip.start + key.time);
    }
  }
  return [...times].sort((a, b) => a - b);
}

/** The clip's start moved by ``seconds`` while its picture stays: keyframes keep their moment. */
export function shiftKeyframes(clip: Clip, seconds: number): Clip {
  if (Math.abs(seconds) < 1e-9 || !hasKeyframes(clip)) return clip;
  return mapKeyframes(clip, (key) => ({ ...key, time: key.time - seconds }));
}

/** The take retimed by ``factor``: keyframes stay on the same moments of it. */
export function scaleKeyframes(clip: Clip, factor: number): Clip {
  if (Math.abs(factor - 1) < 1e-9 || !hasKeyframes(clip)) return clip;
  return mapKeyframes(clip, (key) => ({ ...key, time: key.time * factor }));
}

export function hasKeyframes(clip: Clip): boolean {
  return Object.values(clip.keyframes).some((keys) => keys.length > 0);
}

function mapKeyframes(clip: Clip, map: (key: VideoProjectKeyframe) => VideoProjectKeyframe): Clip {
  const keyframes = noKeyframes();
  for (const property of Object.keys(keyframes) as AnimatedProperty[]) {
    keyframes[property] = clip.keyframes[property].map(map);
  }
  return { ...clip, keyframes };
}

/** 0 away from speech, 1 while it sounds; ramps of nearby spans add up, as the export's. */
export function duckPresence(spans: readonly [number, number][], time: number): number {
  const ramp = VIDEO_PROJECT_DUCK_RAMP_SECONDS;
  let total = 0;
  for (const [start, end] of spans) {
    const rise = Math.min(1, Math.max(0, (time - start + ramp) / ramp));
    const fall = Math.min(1, Math.max(0, (end + ramp - time) / ramp));
    total += Math.min(rise, fall);
  }
  return Math.min(1, total);
}

export function duckLevel(
  spans: readonly [number, number][],
  duckGain: number,
  time: number,
): number {
  return 1 - (1 - duckGain) * duckPresence(spans, time);
}
