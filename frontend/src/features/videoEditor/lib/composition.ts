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

/** Seconds each clip fades in or out over because of a dissolve, linked sound included. */
export function transitionFades(project: Project): {
  fadeIn: Map<string, number>;
  fadeOut: Map<string, number>;
} {
  const fadeIn = new Map<string, number>();
  const fadeOut = new Map<string, number>();
  const byId = new Map(project.clips.map((clip) => [clip.id, clip]));
  const linkedAudio = (clip: Clip) =>
    clip.link_id
      ? project.clips.filter((other) => other.link_id === clip.link_id && other.kind === "audio")
      : [];
  for (const transition of project.transitions) {
    const first = byId.get(transition.from_clip_id);
    const second = byId.get(transition.to_clip_id);
    if (!first || !second) continue;
    const overlap = clipEnd(first) - second.start;
    fadeIn.set(second.id, Math.max(fadeIn.get(second.id) ?? 0, overlap));
    for (const into of linkedAudio(second)) {
      for (const out of linkedAudio(first)) {
        if (into.track_id !== out.track_id) continue;
        fadeIn.set(into.id, Math.max(fadeIn.get(into.id) ?? 0, overlap));
        fadeOut.set(out.id, Math.max(fadeOut.get(out.id) ?? 0, overlap));
      }
    }
  }
  return { fadeIn, fadeOut };
}

export type Fades = ReturnType<typeof transitionFades>;

/** 0..1 at ``time``: the fade in and out ramps, a dissolve counted as a fade in. */
export function fadeLevel(clip: Clip, time: number, fades: Fades): number {
  const fadeIn = Math.min(clip.duration, Math.max(clip.fade_in, fades.fadeIn.get(clip.id) ?? 0));
  const fadeOut = Math.min(clip.duration, Math.max(clip.fade_out, fades.fadeOut.get(clip.id) ?? 0));
  const into = time - clip.start;
  const left = clipEnd(clip) - time;
  let level = 1;
  if (fadeIn > EPSILON) level = Math.min(level, Math.max(0, into / fadeIn));
  if (fadeOut > EPSILON) level = Math.min(level, Math.max(0, left / fadeOut));
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
      const alpha = clip.transform.opacity * fadeLevel(clip, time, fades);
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

export function voicesAt(
  project: Project,
  time: number,
  fades = transitionFades(project),
): Voice[] {
  const audible = audibleTrackIds(project);
  return project.clips
    .filter((clip) => clip.kind === "audio" && audible.has(clip.track_id) && isActiveAt(clip, time))
    .map((clip) => ({ clip, gain: clip.gain * fadeLevel(clip, time, fades) }));
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

/** Fit or fill the canvas, then the clip's own scale and offset. Titles cover the canvas. */
export function placement(project: Project, clip: Clip): Placement {
  if (clip.kind === "title") {
    return {
      centerX: project.width / 2,
      centerY: project.height / 2,
      width: project.width,
      height: project.height,
      rotation: 0,
    };
  }
  const frame = croppedSize(project, clip);
  const pick = clip.fit === "fit" ? Math.min : Math.max;
  const factor =
    pick(project.width / frame.width, project.height / frame.height) * clip.transform.scale;
  return {
    centerX: project.width / 2 + clip.transform.x * project.width,
    centerY: project.height / 2 + clip.transform.y * project.height,
    width: Math.max(2, Math.round(frame.width * factor)),
    height: Math.max(2, Math.round(frame.height * factor)),
    rotation: clip.transform.rotation,
  };
}
