/**
 * The editor's clipboard: clips copied with what they need to be placed again, in this project or
 * another one opened later in the same session, and settings pasted from one clip onto others.
 */
import type { VideoProjectSource, VideoProjectTransition } from "@/shared/types";
import {
  clampFades,
  clipEnd,
  finish,
  lockedMessage,
  newId,
  trackById,
  tracksOfKind,
  withLinked,
  type Clip,
  type EditResult,
  type Project,
  type Track,
} from "./timeline";

export interface ClipboardContent {
  /** The folder the sources were named in; another folder may not hold the same files. */
  folder: string;
  clips: Clip[];
  sources: VideoProjectSource[];
  transitions: VideoProjectTransition[];
  /** Where each source track sat among its kind, counted from V1 up and from A1 down. */
  tracks: { id: string; kind: Track["kind"]; slot: number }[];
  /** The clip whose settings Paste attributes applies: the first one chosen. */
  donorId: string;
}

/** The chosen clips, what is linked to them, and the dissolves among them; null for none. */
export function copyClips(
  project: Project,
  ids: Iterable<string>,
  folder: string,
): ClipboardContent | null {
  const chosen = [...ids];
  const all = withLinked(project, chosen);
  const clips = project.clips.filter((clip) => all.has(clip.id));
  if (clips.length === 0) return null;
  const sourceIds = new Set(clips.map((clip) => clip.source_id));
  const trackIds = new Set(clips.map((clip) => clip.track_id));
  return {
    folder,
    clips,
    sources: project.sources.filter((source) => sourceIds.has(source.id)),
    transitions: project.transitions.filter(
      (transition) => all.has(transition.from_clip_id) && all.has(transition.to_clip_id),
    ),
    tracks: project.tracks
      .filter((track) => trackIds.has(track.id))
      .map((track) => ({ id: track.id, kind: track.kind, slot: trackSlot(project, track) })),
    donorId: chosen.find((id) => all.has(id)) ?? clips[0].id,
  };
}

/** Video tracks count up from the bottom one, V1; audio tracks down from the top one. */
function ordered(project: Project, kind: Track["kind"]): Track[] {
  const tracks = tracksOfKind(project, kind);
  return kind === "video" ? tracks.reverse() : tracks;
}

function trackSlot(project: Project, track: Track): number {
  return ordered(project, track.kind).findIndex((item) => item.id === track.id);
}

/** A pasted clip goes on the track it came from, or the one in the same place among its kind. */
function targetTrack(project: Project, content: ClipboardContent, trackId: string): Track | null {
  const original = content.tracks.find((track) => track.id === trackId);
  if (!original) return null;
  const same = trackById(project, trackId);
  if (same && same.kind === original.kind) return same;
  const candidates = ordered(project, original.kind);
  return candidates[Math.min(original.slot, candidates.length - 1)] ?? null;
}

/**
 * Places a copy with its earliest clip at ``time``, on the matching tracks. Links and dissolves
 * hold among the copies. A file the project already names is reused; any other is added, and
 * ``added`` lists those so their state in this folder can be checked.
 */
export function pasteClips(
  project: Project,
  content: ClipboardContent,
  time: number,
): EditResult & { placed?: string[]; added?: VideoProjectSource[] } {
  const offset = Math.max(0, time) - Math.min(...content.clips.map((clip) => clip.start));
  const sourceIds = new Map<string, string>();
  const added: VideoProjectSource[] = [];
  for (const source of content.sources) {
    const existing = project.sources.find((item) => item.name === source.name);
    if (existing) {
      sourceIds.set(source.id, existing.id);
      continue;
    }
    const taken = project.sources.some((item) => item.id === source.id);
    const copy = taken ? { ...source, id: newId() } : source;
    sourceIds.set(source.id, copy.id);
    added.push(copy);
  }

  const ids = new Map<string, string>();
  const links = new Map<string, string>();
  const clips: Clip[] = [];
  for (const clip of content.clips) {
    const track = targetTrack(project, content, clip.track_id);
    if (!track) {
      return { error: `This project has no ${clip.kind === "audio" ? "audio" : "video"} track.` };
    }
    if (track.locked) return { error: lockedMessage(track) };
    const id = newId();
    ids.set(clip.id, id);
    let link: string | null = null;
    if (clip.link_id) {
      link = links.get(clip.link_id) ?? newId();
      links.set(clip.link_id, link);
    }
    clips.push({
      ...clip,
      id,
      link_id: link,
      track_id: track.id,
      start: clip.start + offset,
      source_id: clip.source_id ? (sourceIds.get(clip.source_id) ?? clip.source_id) : null,
    });
  }
  const transitions = content.transitions.map((transition) => ({
    id: newId(),
    from_clip_id: ids.get(transition.from_clip_id) ?? transition.from_clip_id,
    to_clip_id: ids.get(transition.to_clip_id) ?? transition.to_clip_id,
  }));
  const result = finish({
    ...project,
    sources: [...project.sources, ...added],
    clips: [...project.clips, ...clips],
    transitions: [...project.transitions, ...transitions],
  });
  if (!result.project) {
    const end = Math.max(...clips.map(clipEnd));
    return {
      error: `There is no free space for the pasted clips from the playhead to ${end.toFixed(2)} s. ${result.error}`,
    };
  }
  return { project: result.project, placed: clips.map((clip) => clip.id), added };
}

export type AttributeGroup = "color" | "transform" | "crop" | "fades" | "audio" | "sound" | "title";

export const ATTRIBUTE_LABELS: Record<AttributeGroup, string> = {
  color: "Color adjustments",
  transform: "Transform, fit and animation",
  crop: "Crop",
  fades: "Fades",
  audio: "Gain and envelope",
  sound: "EQ and noise reduction",
  title: "Title style",
};

/** The settings ``group`` covers that ``target`` can take from ``donor``; null when none. */
function attributePatch(group: AttributeGroup, donor: Clip, target: Clip): Partial<Clip> | null {
  const pictured = (clip: Clip) => clip.kind === "video" || clip.kind === "image";
  switch (group) {
    case "color":
      return pictured(donor) && pictured(target)
        ? { adjust: donor.adjust, auto_adjust: donor.auto_adjust ?? null }
        : null;
    case "crop":
      return pictured(donor) && pictured(target) ? { crop: donor.crop } : null;
    case "transform": {
      if (donor.kind === "audio" || target.kind === "audio") return null;
      const { x, y, scale, rotation, opacity } = donor.keyframes;
      const moved = {
        transform: donor.transform,
        keyframes: { ...target.keyframes, x, y, scale, rotation, opacity },
      };
      // A title fits the canvas exactly, so it has no fit to give or take.
      return donor.kind === "title" || target.kind === "title"
        ? moved
        : { ...moved, fit: donor.fit };
    }
    case "fades":
      return donor.kind === "audio" && target.kind === "audio"
        ? { fade_in: donor.fade_in, fade_out: donor.fade_out, fade_curve: donor.fade_curve }
        : { fade_in: donor.fade_in, fade_out: donor.fade_out };
    case "audio":
      return donor.kind === "audio" && target.kind === "audio"
        ? { gain: donor.gain, keyframes: { ...target.keyframes, gain: donor.keyframes.gain } }
        : null;
    case "sound": {
      if (donor.kind !== "audio" || target.kind !== "audio") return null;
      const { bass, mid, treble } = donor.keyframes;
      return {
        audio_effects: donor.audio_effects,
        keyframes: { ...target.keyframes, bass, mid, treble },
      };
    }
    case "title":
      return donor.title && target.title
        ? { title: { ...donor.title, text: target.title.text } }
        : null;
  }
}

/** The groups the donor has that at least one target can take. */
export function pastableGroups(donor: Clip, targets: Clip[]): AttributeGroup[] {
  return (Object.keys(ATTRIBUTE_LABELS) as AttributeGroup[]).filter((group) =>
    targets.some((target) => attributePatch(group, donor, target) !== null),
  );
}

/** Gives the chosen clips the donor's settings in ``groups``; a clip keeps what it cannot take. */
export function pasteAttributes(
  project: Project,
  ids: Iterable<string>,
  donor: Clip,
  groups: Iterable<AttributeGroup>,
): EditResult {
  const chosen = new Set(ids);
  const wanted = [...groups];
  const changed = new Map<string, Clip>();
  for (const clip of project.clips) {
    if (!chosen.has(clip.id) || clip.id === donor.id) continue;
    let next = clip;
    for (const group of wanted) {
      const patch = attributePatch(group, donor, next);
      if (patch) next = { ...next, ...patch };
    }
    if (next === clip) continue;
    const track = trackById(project, clip.track_id);
    if (track?.locked) return { error: lockedMessage(track) };
    changed.set(clip.id, clampFades(next));
  }
  if (changed.size === 0) return { error: "None of the selected clips can take those settings." };
  return finish({ ...project, clips: project.clips.map((clip) => changed.get(clip.id) ?? clip) });
}
