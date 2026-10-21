import { AUDIO_PITCH_MAX_SEMITONES } from "@/shared/constants";
import {
  RESTING_EFFECTS,
  effectsEqual,
  fadeCurveLevel,
  isEffectsIdentity,
} from "@/shared/lib/audioEffects";
import { IDENTITY_EPSILON, sameNumber } from "./editSpec";
import type {
  AudioEditSpec,
  AudioEffects,
  AudioLevel,
  VideoProjectFadeCurve,
} from "@/shared/types";

/** The audio edit's draft and its wire form; trimming shares the video edit's rules. */

/** No Mute: a file of silence is not an edit worth keeping. Capped at 2x like the backend. */
export const AUDIO_VOLUME_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;
export const PITCH_PRESETS = [-12, -7, -5, -2, 0, 2, 5, 7, 12] as const;
export const FADE_PRESETS = [0, 0.5, 1, 2, 3] as const;
export const AUDIO_LEVELS: ReadonlyArray<{ value: AudioLevel; label: string; hint: string }> = [
  { value: "unchanged", label: "As is", hint: "Keeps the level; a boost can clip." },
  { value: "limit", label: "Limit peaks", hint: "Holds peaks under -1 dB." },
  { value: "normalize", label: "Normalize", hint: "Brings it to -14 LUFS, then limits peaks." },
];

/** Trims land on a 10 ms grid: no frames to snap to, and finer is past what a handle can hit. */
export const AUDIO_TRIM_STEP = 0.01;

const TRIM_END_EPSILON = 1e-3;

export interface AudioEditDraft {
  trimStart: number;
  trimEnd: number;
  fadeIn: number;
  fadeOut: number;
  fadeCurve: VideoProjectFadeCurve;
  volume: number;
  level: AudioLevel;
  speed: number;
  pitch: number;
  effects: AudioEffects;
}

export function emptyAudioDraft(duration: number): AudioEditDraft {
  return {
    trimStart: 0,
    trimEnd: Number.isFinite(duration) && duration > 0 ? duration : 0,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: "equal_power",
    volume: 1,
    level: "unchanged",
    speed: 1,
    pitch: 0,
    effects: { ...RESTING_EFFECTS },
  };
}

export function audioOutputDuration(draft: AudioEditDraft): number {
  return Math.max(0, draft.trimEnd - draft.trimStart) / draft.speed;
}

export function isIdentityAudioEdit(draft: AudioEditDraft, duration: number): boolean {
  return (
    draft.trimStart < TRIM_END_EPSILON &&
    draft.trimEnd >= duration - TRIM_END_EPSILON &&
    draft.fadeIn < IDENTITY_EPSILON &&
    draft.fadeOut < IDENTITY_EPSILON &&
    Math.abs(draft.volume - 1) < IDENTITY_EPSILON &&
    draft.level === "unchanged" &&
    Math.abs(draft.speed - 1) < IDENTITY_EPSILON &&
    draft.pitch === 0 &&
    isEffectsIdentity(draft.effects)
  );
}

/** Fades fit the output; a trim or retime that shortens it shortens them, out side first. */
export function fittedFades(draft: AudioEditDraft): AudioEditDraft {
  const length = audioOutputDuration(draft);
  const fadeIn = Math.min(draft.fadeIn, length);
  const fadeOut = Math.min(draft.fadeOut, length - fadeIn);
  if (fadeIn === draft.fadeIn && fadeOut === draft.fadeOut) return draft;
  return { ...draft, fadeIn, fadeOut };
}

export function toAudioEditSpec(draft: AudioEditDraft, duration: number): AudioEditSpec {
  const runsToTheEnd = draft.trimEnd >= duration - TRIM_END_EPSILON;
  return {
    trim_start: draft.trimStart,
    trim_end: runsToTheEnd ? null : draft.trimEnd,
    fade_in: draft.fadeIn,
    fade_out: draft.fadeOut,
    fade_curve: draft.fadeCurve,
    volume: draft.volume,
    level: draft.level,
    speed: draft.speed,
    pitch: draft.pitch,
    effects: { ...draft.effects },
  };
}

export function audioDraftFromSpec(spec: AudioEditSpec | null, duration: number): AudioEditDraft {
  const draft = emptyAudioDraft(duration);
  if (!spec) return draft;

  return fittedFades({
    trimStart: Math.min(spec.trim_start, draft.trimEnd),
    trimEnd: spec.trim_end == null ? draft.trimEnd : Math.min(spec.trim_end, draft.trimEnd),
    fadeIn: spec.fade_in,
    fadeOut: spec.fade_out,
    fadeCurve: spec.fade_curve,
    volume: spec.volume,
    level: spec.level,
    speed: spec.speed,
    pitch: Math.max(-AUDIO_PITCH_MAX_SEMITONES, Math.min(AUDIO_PITCH_MAX_SEMITONES, spec.pitch)),
    effects: { ...spec.effects },
  });
}

export function audioSpecsEqual(a: AudioEditSpec, b: AudioEditSpec): boolean {
  return (
    sameNumber(a.trim_start, b.trim_start) &&
    (a.trim_end == null || b.trim_end == null
      ? a.trim_end == b.trim_end
      : sameNumber(a.trim_end, b.trim_end)) &&
    sameNumber(a.fade_in, b.fade_in) &&
    sameNumber(a.fade_out, b.fade_out) &&
    a.fade_curve === b.fade_curve &&
    sameNumber(a.volume, b.volume) &&
    a.level === b.level &&
    sameNumber(a.speed, b.speed) &&
    a.pitch === b.pitch &&
    effectsEqual(a.effects, b.effects)
  );
}

/** The spec whose loudness a normalize answers to: everything before the level stage. */
export function loudnessKey(spec: AudioEditSpec): AudioEditSpec {
  return { ...spec, level: "unchanged" };
}

/** What the fades leave of the gain at source second `time`, as afade draws them. */
export function fadeGainAt(draft: AudioEditDraft, time: number): number {
  const into = (time - draft.trimStart) / draft.speed;
  const left = audioOutputDuration(draft) - into;
  let level = 1;
  if (draft.fadeIn > IDENTITY_EPSILON) {
    level = Math.min(level, fadeCurveLevel(draft.fadeCurve, into / draft.fadeIn));
  }
  if (draft.fadeOut > IDENTITY_EPSILON) {
    level = Math.min(level, fadeCurveLevel(draft.fadeCurve, left / draft.fadeOut));
  }
  return level;
}

export function formatPitch(semitones: number): string {
  if (semitones === 0) return "0";
  return semitones > 0 ? `+${semitones}` : `−${-semitones}`;
}

export function formatFade(seconds: number): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}
