import type { VideoProjectClip, VideoProjectSource, VideoProjectTrack } from "@/shared/types";
import { restingAdjust, type Project } from "@/features/videoEditor/lib/timeline";

export function makeTrack(
  id: string,
  kind: "video" | "audio",
  patch: Partial<VideoProjectTrack> = {},
): VideoProjectTrack {
  return {
    id,
    kind,
    name: id.toUpperCase(),
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    gain: 1,
    speech: false,
    sync_lock: true,
    collapsed: false,
    ...patch,
  };
}

/** A still on ``trackId`` from ``start`` for ``duration`` seconds, showing the ``still`` source. */
export function makeClip(
  id: string,
  trackId: string,
  start: number,
  duration: number,
  patch: Partial<VideoProjectClip> = {},
): VideoProjectClip {
  return {
    id,
    track_id: trackId,
    kind: "image",
    source_id: "still",
    start,
    duration,
    source_in: 0,
    speed: 1,
    link_id: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    crop: null,
    fit: "fit",
    adjust: restingAdjust(),
    gain: 1,
    fade_in: 0,
    fade_out: 0,
    fade_curve: "equal_power",
    title: null,
    keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], gain: [] },
    ...patch,
  };
}

export function makeSource(
  id: string,
  name: string,
  kind: VideoProjectSource["kind"],
  patch: Partial<VideoProjectSource> = {},
): VideoProjectSource {
  return {
    id,
    name,
    kind,
    size: 1,
    modified_us: 1,
    duration: kind === "image" ? null : 4,
    width: kind === "audio" ? null : 640,
    height: kind === "audio" ? null : 360,
    frame_rate: kind === "video" ? 30 : null,
    has_audio: kind !== "image",
    ...patch,
  };
}

/** 640 × 360 at 30 fps with tracks V2, V1, A1, A2 and two stills on V1 at 0-2 s and 3-5 s. */
export function makeProject(patch: Partial<Project> = {}): Project {
  return {
    format_version: 1,
    id: "p",
    name: "Edit",
    revision: 0,
    created_at: "",
    updated_at: "",
    width: 640,
    height: 360,
    frame_rate: 30,
    initial_source_id: null,
    sources: [makeSource("still", "still.png", "image")],
    tracks: [
      makeTrack("v2", "video"),
      makeTrack("v1", "video"),
      makeTrack("a1", "audio"),
      makeTrack("a2", "audio"),
    ],
    clips: [makeClip("first", "v1", 0, 2), makeClip("second", "v1", 3, 2)],
    transitions: [],
    mix: { master_gain: 1, duck_gain: 0.25 },
    markers: [],
    export: {
      filename: "",
      size: "source",
      orientation: null,
      quality: "standard",
      copy_caption: false,
      audio_level: "limit",
    },
    ...patch,
  };
}
