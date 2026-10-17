import { VIDEO_PROJECT_QUALITY_PRESETS } from "@/shared/constants";
import type { VideoProjectExportSettings, VideoProjectOrientation } from "@/shared/types";
import {
  clipEnd,
  EPSILON,
  projectDuration,
  sourceById,
  type Clip,
  type Project,
  type Track,
} from "./timeline";
import { clipValueAt, duckLevel, transformAt } from "./keyframes";

/**
 * The preview's half of `video_project_render.py`: which layers show at a time, how opaque, and
 * where. Both must agree or the export would not match what was watched.
 */

const PRESET_SHORT_SIDES = { "720p": 720, "1080p": 1080 } as const;
const WIDESCREEN = 16 / 9;

function even(value: number): number {
  return Math.max(2, Math.floor(Math.round(value) / 2) * 2);
}

export function projectOrientation(width: number, height: number): VideoProjectOrientation {
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
}

export function exportSize(
  project: Pick<Project, "width" | "height">,
  settings: VideoProjectExportSettings,
): { width: number; height: number } {
  const orientation = settings.orientation ?? projectOrientation(project.width, project.height);
  const [longSide, shortSide] =
    settings.size === "source"
      ? [Math.max(project.width, project.height), Math.min(project.width, project.height)]
      : [
          Math.round(PRESET_SHORT_SIDES[settings.size] * WIDESCREEN),
          PRESET_SHORT_SIDES[settings.size],
        ];
  if (orientation === "landscape") return { width: even(longSide), height: even(shortSide) };
  if (orientation === "portrait") return { width: even(shortSide), height: even(longSide) };
  return { width: even(shortSide), height: even(shortSide) };
}

/** The frame size the presets' bits-per-pixel figures were read at. */
const ESTIMATE_REFERENCE_PIXELS = 1920 * 1080;
/** x264 spends fewer bits on each pixel of a bigger frame; sample clips fit pixels^-0.2. */
const ESTIMATE_PIXEL_EXPONENT = -0.2;

/**
 * A middle guess at the exported file's bytes. Rate-factor encodes follow the footage, so busy
 * or grainy video can come out several times larger. Silent audio encodes to almost nothing.
 */
export function estimateExportBytes(
  project: Project,
  settings: VideoProjectExportSettings,
): number {
  const { width, height } = exportSize(project, settings);
  const quality = VIDEO_PROJECT_QUALITY_PRESETS[settings.quality];
  const pixels = width * height;
  const bitsPerPixel =
    quality.bits_per_pixel * (pixels / ESTIMATE_REFERENCE_PIXELS) ** ESTIMATE_PIXEL_EXPONENT;
  const audioBits = project.clips.some((clip) => clip.kind === "audio")
    ? quality.audio_kbps * 1000
    : 0;
  const bitsPerSecond = bitsPerPixel * pixels * project.frame_rate + audioBits;
  return (bitsPerSecond * projectDuration(project)) / 8;
}

/**
 * Seconds each clip fades in or out over: a dissolve's incoming picture, and both sides of each
 * sound overlap on an audio track, a dissolve's linked sound among them.
 */
export function transitionFades(project: Project): {
  fadeIn: Map<string, number>;
  fadeOut: Map<string, number>;
} {
  const fadeIn = new Map<string, number>();
  const fadeOut = new Map<string, number>();
  const raise = (map: Map<string, number>, id: string, seconds: number) =>
    map.set(id, Math.max(map.get(id) ?? 0, seconds));
  const byId = new Map(project.clips.map((clip) => [clip.id, clip]));
  for (const transition of project.transitions) {
    const first = byId.get(transition.from_clip_id);
    const second = byId.get(transition.to_clip_id);
    if (!first || !second) continue;
    raise(fadeIn, second.id, clipEnd(first) - second.start);
  }
  for (const track of project.tracks) {
    if (track.kind !== "audio") continue;
    const ordered = project.clips
      .filter((clip) => clip.track_id === track.id)
      .sort((a, b) => a.start - b.start);
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const overlap = clipEnd(ordered[index]) - ordered[index + 1].start;
      if (overlap <= EPSILON) continue;
      raise(fadeOut, ordered[index].id, overlap);
      raise(fadeIn, ordered[index + 1].id, overlap);
    }
  }
  return { fadeIn, fadeOut };
}

export type Fades = ReturnType<typeof transitionFades>;

/** A ramp's level for ``progress`` 0..1; equal power is ffmpeg's quarter sine, ``qsin``. */
function fadeShape(clip: Clip, progress: number): number {
  const level = Math.min(1, Math.max(0, progress));
  return clip.kind === "audio" && clip.fade_curve === "equal_power"
    ? Math.sin((level * Math.PI) / 2)
    : level;
}

/** 0..1 at ``time``: the fade in and out ramps, a dissolve or crossfade counted as a fade. */
export function fadeLevel(clip: Clip, time: number, fades: Fades): number {
  const fadeIn = Math.min(clip.duration, Math.max(clip.fade_in, fades.fadeIn.get(clip.id) ?? 0));
  const fadeOut = Math.min(clip.duration, Math.max(clip.fade_out, fades.fadeOut.get(clip.id) ?? 0));
  const into = time - clip.start;
  const left = clipEnd(clip) - time;
  let level = 1;
  if (fadeIn > EPSILON) level = Math.min(level, fadeShape(clip, into / fadeIn));
  if (fadeOut > EPSILON) level = Math.min(level, fadeShape(clip, left / fadeOut));
  return level;
}

/**
 * The instant whose picture shows at ``time``. A clip covers its start but not its end, so the
 * end itself has nothing on it; there the preview holds the last frame instead of going black.
 */
export function pictureTime(project: Project, time: number): number {
  const end = projectDuration(project);
  if (end <= 0 || time < end - EPSILON) return time;
  return Math.max(0, end - 0.5 / project.frame_rate);
}

export function isActiveAt(clip: Clip, time: number): boolean {
  return time >= clip.start - EPSILON && time < clipEnd(clip) - EPSILON;
}

export function sourceTimeAt(clip: Clip, time: number): number {
  return clip.source_in + (time - clip.start) * clip.speed;
}

export interface Layer {
  clip: Clip;
  track: Track;
  /** Multiplied opacity and fade. */
  alpha: number;
}

/** Visible picture layers at ``time``, bottom first, as the export stacks them. */
export function layersAt(
  project: Project,
  time: number,
  fades = transitionFades(project),
): Layer[] {
  const layers: Layer[] = [];
  const videoTracks = project.tracks.filter((track) => track.kind === "video").reverse();
  for (const track of videoTracks) {
    if (track.hidden) continue;
    const clips = project.clips
      .filter((clip) => clip.track_id === track.id && isActiveAt(clip, time))
      .sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      const alpha = clipValueAt(clip, "opacity", time) * fadeLevel(clip, time, fades);
      layers.push({ clip, track, alpha });
    }
  }
  return layers;
}

/** Solo silences every other track; mute wins over solo. */
export function audibleTrackIds(project: Project): Set<string> {
  const audio = project.tracks.filter((track) => track.kind === "audio");
  const soloed = audio.some((track) => track.solo);
  return new Set(
    audio.filter((track) => !track.muted && (track.solo || !soloed)).map((track) => track.id),
  );
}

export interface Voice {
  clip: Clip;
  gain: number;
}

/** Where speech sounds: the clips on audible speech tracks, as the export reads them. */
export function speechSpans(project: Project, audible = audibleTrackIds(project)) {
  const speech = new Set(
    project.tracks.filter((track) => track.speech && audible.has(track.id)).map((t) => t.id),
  );
  return project.clips
    .filter((clip) => clip.kind === "audio" && speech.has(clip.track_id) && sounds(clip))
    .map((clip): [number, number] => [clip.start, clipEnd(clip)])
    .sort((a, b) => a[0] - b[0]);
}

function sounds(clip: Clip): boolean {
  const keys = clip.keyframes.gain;
  return keys.length > 0 ? keys.some((key) => key.value > 0) : clip.gain > 0;
}

/** Each clip's gain at ``time``: its envelope, fades, track gain, ducking and the master. */
export function voicesAt(
  project: Project,
  time: number,
  fades = transitionFades(project),
): Voice[] {
  const audible = audibleTrackIds(project);
  const spans = speechSpans(project, audible);
  const duck = spans.length > 0 ? duckLevel(spans, project.mix.duck_gain, time) : 1;
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  return project.clips
    .filter((clip) => clip.kind === "audio" && audible.has(clip.track_id) && isActiveAt(clip, time))
    .map((clip) => {
      const track = tracks.get(clip.track_id);
      const level =
        clipValueAt(clip, "gain", time) *
        fadeLevel(clip, time, fades) *
        (track?.gain ?? 1) *
        (track?.speech ? 1 : duck) *
        project.mix.master_gain;
      return { clip, gain: level };
    });
}

export interface Size {
  width: number;
  height: number;
}

/** The picture a clip shows before placement: its source, less the crop. */
export function croppedSize(project: Project, clip: Clip): Size {
  if (clip.kind === "title") return { width: project.width, height: project.height };
  const source = sourceById(project, clip.source_id);
  const width = source?.width ?? project.width;
  const height = source?.height ?? project.height;
  if (!clip.crop) return { width, height };
  return {
    width: Math.max(2, Math.trunc((width * clip.crop.width) / 2) * 2),
    height: Math.max(2, Math.trunc((height * clip.crop.height) / 2) * 2),
  };
}

export interface Placement {
  /** Center of the layer in canvas pixels. */
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Fit or fill the canvas, then the clip's own scale and offset at ``time``. A title is drawn at
 * the canvas size, so it fits it exactly before its own transform.
 */
export function placement(project: Project, clip: Clip, time: number): Placement {
  const transform = transformAt(clip, time);
  const frame = croppedSize(project, clip);
  const pick = clip.fit === "fit" ? Math.min : Math.max;
  const factor = pick(project.width / frame.width, project.height / frame.height) * transform.scale;
  return {
    centerX: project.width / 2 + transform.x * project.width,
    centerY: project.height / 2 + transform.y * project.height,
    width: Math.max(2, Math.round(frame.width * factor)),
    height: Math.max(2, Math.round(frame.height * factor)),
    rotation: transform.rotation,
  };
}
