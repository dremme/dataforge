import {
  VIDEO_PROJECT_UNTITLED_NAME,
  VIDEO_PROJECT_MAX_TRACKS,
  VIDEO_PROJECT_MIN_CLIP_SECONDS,
  VIDEO_PROJECT_STILL_SECONDS,
  VIDEO_PROJECT_TIME_EPSILON,
} from "@/shared/constants";
import type {
  VideoProject,
  VideoProjectClip,
  VideoProjectSource,
  VideoProjectSourceInfo,
  VideoProjectTrack,
  VideoProjectTrackKind,
  VideoProjectTransition,
} from "@/shared/types";
import { noKeyframes, scaleKeyframes, shiftKeyframes } from "./keyframes";

export type Project = VideoProject;
export type Clip = VideoProjectClip;
export type Track = VideoProjectTrack;

/** An edit either produces the next project or explains why it cannot be made. */
export type EditResult =
  { project: Project; error?: undefined } | { project?: undefined; error: string };

export const EPSILON = VIDEO_PROJECT_TIME_EPSILON;
export const MIN_CLIP_SECONDS = VIDEO_PROJECT_MIN_CLIP_SECONDS;
export const STILL_SECONDS = VIDEO_PROJECT_STILL_SECONDS;
export const TITLE_SECONDS = 3;
export const DEFAULT_DISSOLVE_SECONDS = 1;

/** `getRandomValues`, not `randomUUID`: the latter is absent over plain HTTP on a LAN address. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function projectDuration(project: Project): number {
  return project.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
}

/** Times on the project's frame grid, so cuts and handles land between frames. */
export function snapToFrame(time: number, frameRate: number): number {
  return Math.max(0, Math.round(time * frameRate) / frameRate);
}

export function trackById(project: Project, id: string): Track | undefined {
  return project.tracks.find((track) => track.id === id);
}

export function sourceById(project: Project, id: string | null | undefined) {
  return id ? project.sources.find((source) => source.id === id) : undefined;
}

export function clipTrackKind(clip: Clip): VideoProjectTrackKind {
  return clip.kind === "audio" ? "audio" : "video";
}

export function isVisualClip(clip: Clip): boolean {
  return clip.kind !== "audio";
}

export function clipLabel(project: Project, clip: Clip): string {
  if (clip.kind === "title") return clip.title?.text.trim().split("\n")[0] || "Title";
  return sourceById(project, clip.source_id)?.name ?? "Missing source";
}

/** Every clip moving with these: the selection plus whatever is linked to it. */
export function withLinked(project: Project, ids: Iterable<string>): Set<string> {
  const chosen = new Set(ids);
  const links = new Set<string>();
  for (const clip of project.clips) {
    if (chosen.has(clip.id) && clip.link_id) links.add(clip.link_id);
  }
  for (const clip of project.clips) {
    if (clip.link_id && links.has(clip.link_id)) chosen.add(clip.id);
  }
  return chosen;
}

export function lockedTrackOf(project: Project, ids: Set<string>): Track | undefined {
  for (const clip of project.clips) {
    if (!ids.has(clip.id)) continue;
    const track = trackById(project, clip.track_id);
    if (track?.locked) return track;
  }
  return undefined;
}

export function lockedMessage(track: Track): string {
  return `${track.name} is locked. Unlock it to change its clips.`;
}

/** Pictures allowed to overlap: a dissolve's two clips. Sound follows `crossfadeProblem`. */
function overlapPairs(project: Project): Set<string> {
  return new Set(
    project.transitions.map((transition) =>
      pairKey(transition.from_clip_id, transition.to_clip_id),
    ),
  );
}

/**
 * Sound on one track may overlap the next clip and cross-fade over the overlap, but never cover
 * a clip whole or sound three at once. ``clips`` are in start order.
 */
function crossfadeProblem(project: Project, track: Track, clips: Clip[]): string | null {
  for (let index = 0; index < clips.length; index += 1) {
    for (let later = index + 1; later < clips.length; later += 1) {
      if (clips[later].start >= clipEnd(clips[index]) - EPSILON) break;
      const first = clipLabel(project, clips[index]);
      const second = clipLabel(project, clips[later]);
      if (later !== index + 1) {
        return `Three clips would sound at once on ${track.name}. A crossfade joins two clips.`;
      }
      if (
        clips[later].start <= clips[index].start + EPSILON ||
        clipEnd(clips[later]) <= clipEnd(clips[index])
      ) {
        return `${first} and ${second} would cover each other on ${track.name}. Overlapping sound cross-fades, so each clip must start and end on its own.`;
      }
    }
  }
  return null;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The first rule the project breaks, in words for the person editing; null when it is valid. */
export function placementProblem(project: Project): string | null {
  const allowed = overlapPairs(project);
  for (const clip of project.clips) {
    const track = trackById(project, clip.track_id);
    if (!track) return "A clip lost its track.";
    if (track.kind !== clipTrackKind(clip)) {
      return clip.kind === "audio"
        ? "Sound goes on an audio track."
        : "Pictures and titles go on a video track.";
    }
    if (clip.start < -EPSILON) return "A clip cannot start before 00:00.";
    if (clip.duration < MIN_CLIP_SECONDS - EPSILON) return "That would leave a clip too short.";
  }
  for (const track of project.tracks) {
    const clips = project.clips
      .filter((clip) => clip.track_id === track.id)
      .sort((a, b) => a.start - b.start);
    if (track.kind === "audio") {
      const problem = crossfadeProblem(project, track, clips);
      if (problem) return problem;
      continue;
    }
    for (let index = 0; index < clips.length; index += 1) {
      for (let later = index + 1; later < clips.length; later += 1) {
        if (clips[later].start >= clipEnd(clips[index]) - EPSILON) break;
        if (allowed.has(pairKey(clips[index].id, clips[later].id))) continue;
        const first = clipLabel(project, clips[index]);
        const second = clipLabel(project, clips[later]);
        return `${first} and ${second} would overlap on ${track.name}. Clips on one track never cover each other; use free space or another track.`;
      }
    }
  }
  return null;
}

/** Dissolves whose clips no longer overlap on one track are gone: separating them removes them. */
export function pruneTransitions(project: Project): Project {
  const byId = new Map(project.clips.map((clip) => [clip.id, clip]));
  const transitions = project.transitions.filter((transition) => {
    const first = byId.get(transition.from_clip_id);
    const second = byId.get(transition.to_clip_id);
    if (!first || !second || first.track_id !== second.track_id) return false;
    return (
      first.start < second.start &&
      second.start < clipEnd(first) - EPSILON &&
      clipEnd(second) > clipEnd(first)
    );
  });
  return transitions.length === project.transitions.length ? project : { ...project, transitions };
}

/** Drops dissolves the edit pulled apart, then checks the placement rules. */
export function finish(project: Project): EditResult {
  const pruned = pruneTransitions(project);
  const problem = placementProblem(pruned);
  return problem ? { error: problem } : { project: pruned };
}

export function replaceClips(project: Project, changed: Map<string, Clip>): Project {
  return { ...project, clips: project.clips.map((clip) => changed.get(clip.id) ?? clip) };
}

export function sourceSpanLimit(project: Project, clip: Clip): number {
  if (clip.kind !== "video" && clip.kind !== "audio") return Infinity;
  const duration = sourceById(project, clip.source_id)?.duration;
  return duration ?? Infinity;
}

export function clampFades(clip: Clip): Clip {
  const fadeIn = Math.min(clip.fade_in, clip.duration);
  const fadeOut = Math.min(clip.fade_out, clip.duration - fadeIn);
  return fadeIn === clip.fade_in && fadeOut === clip.fade_out
    ? clip
    : { ...clip, fade_in: fadeIn, fade_out: fadeOut };
}

/** Same-kind tracks in display order, so a vertical drag can step between them. */
export function tracksOfKind(project: Project, kind: VideoProjectTrackKind): Track[] {
  return project.tracks.filter((track) => track.kind === kind);
}

export interface MoveRequest {
  ids: Iterable<string>;
  delta: number;
  /** Clips of the dragged clip's kind step this many tracks down the display order. */
  trackShift?: number;
  draggedId?: string;
}

/** Linked clips move along in time; only clips of the dragged kind change track. */
export function moveClips(project: Project, request: MoveRequest): EditResult {
  const shifted = shiftClips(project, request);
  return shifted.project ? finish(shifted.project) : shifted;
}

/**
 * A drag that would cover another clip stops flush against it instead: of the spots where the
 * moved clips touch a neighbour on their track, the valid one nearest the pointer wins.
 */
export function moveClipsFlush(project: Project, request: MoveRequest): EditResult {
  const shifted = shiftClips(project, request);
  if (!shifted.project) return shifted;
  const result = finish(shifted.project);
  if (result.project) return result;

  const moving = withLinked(project, request.ids);
  const moved = shifted.project.clips.filter((clip) => moving.has(clip.id));
  const deltas: number[] = [];
  for (const clip of moved) {
    for (const other of shifted.project.clips) {
      if (moving.has(other.id) || other.track_id !== clip.track_id) continue;
      deltas.push(request.delta + clipEnd(other) - clip.start);
      deltas.push(request.delta + other.start - clipEnd(clip));
    }
  }
  return (
    nearestValid(deltas, request.delta, (delta) => moveClips(project, { ...request, delta })) ??
    result
  );
}

/** The first valid edit among ``candidates``, tried nearest ``wanted`` first. */
function nearestValid(
  candidates: number[],
  wanted: number,
  attempt: (candidate: number) => EditResult,
): EditResult | null {
  const ordered = [...new Set(candidates)].sort(
    (a, b) => Math.abs(a - wanted) - Math.abs(b - wanted),
  );
  for (const candidate of ordered) {
    const result = attempt(candidate);
    if (result.project) return result;
  }
  return null;
}

function shiftClips(project: Project, request: MoveRequest): EditResult {
  const ids = withLinked(project, request.ids);
  const shift = request.trackShift ?? 0;
  const dragged = project.clips.find((clip) => clip.id === request.draggedId);
  const kind = dragged ? clipTrackKind(dragged) : null;
  const locked = lockedTrackOf(project, ids);
  if (locked) return { error: lockedMessage(locked) };

  const changed = new Map<string, Clip>();
  for (const clip of project.clips) {
    if (!ids.has(clip.id)) continue;
    let trackId = clip.track_id;
    if (shift !== 0 && kind && clipTrackKind(clip) === kind) {
      const ordered = tracksOfKind(project, kind);
      const index = ordered.findIndex((track) => track.id === clip.track_id) + shift;
      if (index < 0 || index >= ordered.length) {
        return { error: `There is no ${kind} track there.` };
      }
      if (ordered[index].locked) return { error: lockedMessage(ordered[index]) };
      trackId = ordered[index].id;
    }
    const start = clip.start + request.delta;
    if (start < -EPSILON) return { error: "A clip cannot start before 00:00." };
    changed.set(clip.id, { ...clip, start: Math.max(0, start), track_id: trackId });
  }
  return { project: replaceClips(project, changed) };
}

export type TrimEdge = "start" | "end";

export function isTimedClip(clip: Clip): boolean {
  return clip.kind === "video" || clip.kind === "audio";
}

/**
 * How far one edge of every clip in ``ids`` can travel, later being positive, while each keeps
 * a frame and shows only its source. The tightest clip decides, so linked clips stay in sync.
 * A start edge may also be held at 00:00 by ``floor``, as a trim that moves it is.
 */
export function edgeTravel(
  project: Project,
  ids: Set<string>,
  edge: TrimEdge,
  floor = true,
): { min: number; max: number } {
  let min = -Infinity;
  let max = Infinity;
  for (const clip of project.clips) {
    if (!ids.has(clip.id)) continue;
    if (edge === "start") {
      if (isTimedClip(clip)) min = Math.max(min, -clip.source_in / clip.speed);
      if (floor) min = Math.max(min, -clip.start);
      max = Math.min(max, clip.duration - MIN_CLIP_SECONDS);
    } else {
      const limit = sourceSpanLimit(project, clip);
      min = Math.max(min, MIN_CLIP_SECONDS - clip.duration);
      max = Math.min(max, (limit - clip.source_in) / clip.speed - clip.duration);
    }
  }
  return { min, max };
}

export function clampTravel(travel: number, bounds: { min: number; max: number }): number {
  return Math.min(Math.max(travel, bounds.min), Math.max(bounds.min, bounds.max));
}

/** Moves one edge of the clip and every clip linked to it to ``time``, inside the source. */
export function trimClip(project: Project, id: string, edge: TrimEdge, time: number): EditResult {
  const ids = withLinked(project, [id]);
  const locked = lockedTrackOf(project, ids);
  if (locked) return { error: lockedMessage(locked) };
  const anchor = project.clips.find((clip) => clip.id === id);
  if (!anchor) return { error: "That clip is gone." };

  const from = edge === "start" ? anchor.start : clipEnd(anchor);
  const delta = clampTravel(time - from, edgeTravel(project, ids, edge));
  if (Math.abs(delta) < 1e-9) return { project };
  const changed = new Map<string, Clip>();
  for (const clip of project.clips) {
    if (!ids.has(clip.id)) continue;
    const trimmed =
      edge === "start"
        ? shiftKeyframes(
            {
              ...clip,
              start: clip.start + delta,
              duration: clip.duration - delta,
              source_in:
                clip.kind === "video" || clip.kind === "audio"
                  ? Math.max(0, clip.source_in + delta * clip.speed)
                  : clip.source_in,
            },
            delta,
          )
        : { ...clip, duration: clip.duration + delta };
    changed.set(clip.id, clampFades(trimmed));
  }
  return finish(replaceClips(project, changed));
}

/** Like `moveClipsFlush`: an edge dragged into a neighbour stops at the neighbour's edge. */
export function trimClipFlush(
  project: Project,
  id: string,
  edge: TrimEdge,
  time: number,
): EditResult {
  const result = trimClip(project, id, edge, time);
  const anchor = project.clips.find((clip) => clip.id === id);
  if (result.project || !anchor) return result;

  const linked = withLinked(project, [id]);
  const anchorEdge = edge === "start" ? anchor.start : clipEnd(anchor);
  const times: number[] = [];
  for (const clip of project.clips) {
    if (!linked.has(clip.id)) continue;
    for (const other of project.clips) {
      if (linked.has(other.id) || other.track_id !== clip.track_id) continue;
      // Only a neighbour on the side the edge travels toward can stop it.
      if (edge === "start" ? other.start >= clip.start : other.start <= clip.start) continue;
      // Every linked edge travels as far as the anchor's, so meeting one neighbour is one shift.
      const shift = edge === "start" ? clipEnd(other) - clip.start : other.start - clipEnd(clip);
      times.push(anchorEdge + shift);
    }
  }
  return nearestValid(times, time, (target) => trimClip(project, id, edge, target)) ?? result;
}

/** The two halves of a clip cut at ``time``; the right half gets a fresh id. */
function splitOne(clip: Clip, time: number, rightId: string, rightLink: string | null) {
  const offset = time - clip.start;
  const left: Clip = clampFades({ ...clip, duration: offset, fade_out: 0 });
  const right: Clip = clampFades(
    shiftKeyframes(
      {
        ...clip,
        id: rightId,
        link_id: rightLink,
        start: time,
        duration: clip.duration - offset,
        source_in:
          clip.kind === "video" || clip.kind === "audio"
            ? clip.source_in + offset * clip.speed
            : clip.source_in,
        fade_in: 0,
      },
      offset,
    ),
  );
  return { left, right };
}

/**
 * Cuts the chosen clips and their linked partners at ``time``. Without a choice it cuts every
 * clip under the playhead on an unlocked track.
 */
export function splitClips(project: Project, time: number, ids?: Iterable<string>): EditResult {
  const chosen = ids
    ? withLinked(project, ids)
    : withLinked(
        project,
        project.clips
          .filter((clip) => !trackById(project, clip.track_id)?.locked)
          .map((clip) => clip.id),
      );
  const targets = project.clips.filter(
    (clip) =>
      chosen.has(clip.id) &&
      clip.start + MIN_CLIP_SECONDS - EPSILON < time &&
      time < clipEnd(clip) - MIN_CLIP_SECONDS + EPSILON,
  );
  if (targets.length === 0) return { error: "Nothing to split under the playhead." };
  const locked = lockedTrackOf(project, new Set(targets.map((clip) => clip.id)));
  if (locked) return { error: lockedMessage(locked) };

  for (const transition of project.transitions) {
    const inside = project.clips.find((clip) => clip.id === transition.to_clip_id);
    const outgoing = project.clips.find((clip) => clip.id === transition.from_clip_id);
    if (inside && outgoing && time > inside.start - EPSILON && time < clipEnd(outgoing) + EPSILON) {
      if (targets.some((clip) => clip.id === inside.id || clip.id === outgoing.id)) {
        return { error: "Split before or after the dissolve, not inside it." };
      }
    }
  }

  const rightLinks = new Map<string, string>();
  const rightIds = new Map<string, string>();
  const clips: Clip[] = [];
  for (const clip of project.clips) {
    if (!targets.includes(clip)) {
      clips.push(clip);
      continue;
    }
    let rightLink: string | null = null;
    if (clip.link_id) {
      rightLink = rightLinks.get(clip.link_id) ?? newId();
      rightLinks.set(clip.link_id, rightLink);
    }
    const rightId = newId();
    rightIds.set(clip.id, rightId);
    const { left, right } = splitOne(clip, time, rightId, rightLink);
    clips.push(left, right);
  }
  // A dissolve out of a cut clip now leaves from its right half.
  const transitions = project.transitions.map((transition) => {
    const moved = rightIds.get(transition.from_clip_id);
    return moved ? { ...transition, from_clip_id: moved } : transition;
  });
  return finish({ ...project, clips, transitions });
}

/** Removes the clips and whatever is linked to them; their time stays empty. */
export function deleteClips(project: Project, ids: Iterable<string>): EditResult {
  const chosen = withLinked(project, ids);
  if (chosen.size === 0) return { error: "Select a clip to delete." };
  const locked = lockedTrackOf(project, chosen);
  if (locked) return { error: lockedMessage(locked) };
  return finish({
    ...project,
    clips: project.clips.filter((clip) => !chosen.has(clip.id)),
    transitions: project.transitions.filter(
      (t) => !chosen.has(t.from_clip_id) && !chosen.has(t.to_clip_id),
    ),
  });
}

/** Copies placed straight after the selection on the same tracks, links kept among themselves. */
export function duplicateClips(
  project: Project,
  ids: Iterable<string>,
): EditResult & {
  copies?: string[];
} {
  const chosen = withLinked(project, ids);
  const originals = project.clips.filter((clip) => chosen.has(clip.id));
  if (originals.length === 0) return { error: "Select a clip to duplicate." };
  const first = Math.min(...originals.map((clip) => clip.start));
  const last = Math.max(...originals.map(clipEnd));
  const shift = last - first;
  const links = new Map<string, string>();
  const copies = originals.map((clip) => {
    let link: string | null = null;
    if (clip.link_id) {
      link = links.get(clip.link_id) ?? newId();
      links.set(clip.link_id, link);
    }
    return { ...clip, id: newId(), link_id: link, start: clip.start + shift };
  });
  const result = finish({ ...project, clips: [...project.clips, ...copies] });
  if (!result.project) {
    return { error: "There is no free space right after the selection for its copy." };
  }
  return { project: result.project, copies: copies.map((clip) => clip.id) };
}

export interface TimeRange {
  start: number;
  end: number;
}

/**
 * The clips a ripple edit may move: those on tracks with sync lock on or among ``tracks``, the
 * tracks being edited, and whatever is linked to them, so a picture never leaves its sound.
 */
export function rippleScope(project: Project, tracks: Iterable<string> = []): Set<string> {
  const edited = new Set(tracks);
  const synced = new Set(
    project.tracks.filter((track) => track.sync_lock || edited.has(track.id)).map((t) => t.id),
  );
  return withLinked(
    project,
    project.clips.filter((clip) => synced.has(clip.track_id)).map((clip) => clip.id),
  );
}

/** Tracks a ripple over ``range`` would change: any clip in its scope ending after its start. */
export function rippleTouchedTracks(project: Project, range: TimeRange): Track[] {
  const scope = rippleScope(project);
  const touched = new Set(
    project.clips
      .filter((clip) => scope.has(clip.id) && clipEnd(clip) > range.start + EPSILON)
      .map((c) => c.track_id),
  );
  return project.tracks.filter((track) => touched.has(track.id));
}

/**
 * Removes ``range`` from every track with sync lock on and closes the gap. A clip crossing an
 * edge keeps the part outside; a clip spanning the whole range is cut in two, and the halves meet
 * at its start. Tracks with sync lock off keep their clips where they are.
 */
export function rippleDelete(project: Project, range: TimeRange): EditResult {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(range.start, range.end);
  const gap = end - start;
  if (gap < MIN_CLIP_SECONDS) return { error: "Select a longer range to ripple delete." };
  const locked = rippleTouchedTracks(project, { start, end }).find((track) => track.locked);
  if (locked) {
    return {
      error: `Ripple delete would change ${locked.name}, which is locked. Unlock ${locked.name} first.`,
    };
  }

  const scope = rippleScope(project);
  const rightLinks = new Map<string, string>();
  const clips: Clip[] = [];
  const shiftSource = (clip: Clip, by: number) =>
    clip.kind === "video" || clip.kind === "audio"
      ? clip.source_in + by * clip.speed
      : clip.source_in;

  for (const clip of project.clips) {
    const clipStart = clip.start;
    const clipStop = clipEnd(clip);
    if (!scope.has(clip.id) || clipStop <= start + EPSILON) {
      clips.push(clip);
    } else if (clipStart >= end - EPSILON) {
      clips.push({ ...clip, start: clipStart - gap });
    } else if (clipStart >= start - EPSILON && clipStop <= end + EPSILON) {
      continue;
    } else if (clipStart < start && clipStop <= end + EPSILON) {
      clips.push(clampFades({ ...clip, duration: start - clipStart }));
    } else if (clipStart >= start - EPSILON) {
      clips.push(
        clampFades(
          shiftKeyframes(
            {
              ...clip,
              start,
              duration: clipStop - end,
              source_in: shiftSource(clip, end - clipStart),
            },
            end - clipStart,
          ),
        ),
      );
    } else {
      let link: string | null = null;
      if (clip.link_id) {
        link = rightLinks.get(clip.link_id) ?? newId();
        rightLinks.set(clip.link_id, link);
      }
      clips.push(clampFades({ ...clip, duration: start - clipStart, fade_out: 0 }));
      clips.push(
        clampFades(
          shiftKeyframes(
            {
              ...clip,
              id: newId(),
              link_id: link,
              start,
              duration: clipStop - end,
              source_in: shiftSource(clip, end - clipStart),
              fade_in: 0,
            },
            end - clipStart,
          ),
        ),
      );
    }
  }
  const kept = clips.filter((clip) => clip.duration >= MIN_CLIP_SECONDS - EPSILON);
  return finish({ ...project, clips: kept });
}

/** Changes the constant speed of a clip and its linked partners; the take stays the same. */
export function setClipSpeed(project: Project, id: string, speed: number): EditResult {
  const ids = withLinked(project, [id]);
  const locked = lockedTrackOf(project, ids);
  if (locked) return { error: lockedMessage(locked) };
  const changed = new Map<string, Clip>();
  for (const clip of project.clips) {
    if (!ids.has(clip.id) || (clip.kind !== "video" && clip.kind !== "audio")) continue;
    const duration = (clip.duration * clip.speed) / speed;
    changed.set(
      clip.id,
      clampFades(scaleKeyframes({ ...clip, speed, duration }, clip.speed / speed)),
    );
  }
  const result = finish(replaceClips(project, changed));
  return result.error
    ? { error: `At that speed the clip would run into the next one. ${result.error}` }
    : result;
}

/** For stills and titles, whose length is not bound to a source. */
export function setClipDuration(project: Project, id: string, duration: number): EditResult {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return { error: "That clip is gone." };
  return trimClip(project, id, "end", clip.start + Math.max(MIN_CLIP_SECONDS, duration));
}

export function updateClip(project: Project, id: string, patch: Partial<Clip>): EditResult {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return { error: "That clip is gone." };
  const track = trackById(project, clip.track_id);
  if (track?.locked) return { error: lockedMessage(track) };
  return finish(replaceClips(project, new Map([[id, clampFades({ ...clip, ...patch })]])));
}

export function unlinkClips(project: Project, ids: Iterable<string>): EditResult {
  const chosen = withLinked(project, ids);
  return finish({
    ...project,
    clips: project.clips.map((clip) => (chosen.has(clip.id) ? { ...clip, link_id: null } : clip)),
  });
}

/** Links a video clip with audio clips that cover exactly the same time. */
export function linkClips(project: Project, ids: Iterable<string>): EditResult {
  const chosen = project.clips.filter((clip) => new Set(ids).has(clip.id));
  const video = chosen.filter((clip) => clip.kind === "video");
  const audio = chosen.filter((clip) => clip.kind === "audio");
  if (video.length !== 1 || audio.length === 0) {
    return { error: "Select one video clip and the audio clips to link with it." };
  }
  const aligned = audio.every(
    (clip) =>
      Math.abs(clip.start - video[0].start) < EPSILON &&
      Math.abs(clip.duration - video[0].duration) < EPSILON,
  );
  if (!aligned) return { error: "Linked clips must start and end at the same time." };
  const link = newId();
  const members = new Set(chosen.map((clip) => clip.id));
  return finish({
    ...project,
    clips: project.clips.map((clip) => (members.has(clip.id) ? { ...clip, link_id: link } : clip)),
  });
}

export function findTransition(project: Project, clipId: string): VideoProjectTransition[] {
  return project.transitions.filter(
    (transition) => transition.from_clip_id === clipId || transition.to_clip_id === clipId,
  );
}

export function transitionOverlap(project: Project, transition: VideoProjectTransition): number {
  const first = project.clips.find((clip) => clip.id === transition.from_clip_id);
  const second = project.clips.find((clip) => clip.id === transition.to_clip_id);
  return first && second ? clipEnd(first) - second.start : 0;
}

/** The next clip on the same track after ``clip``, the partner a dissolve would join. */
export function nextNeighbour(project: Project, clip: Clip): Clip | undefined {
  return project.clips
    .filter(
      (other) =>
        other.id !== clip.id &&
        other.track_id === clip.track_id &&
        other.start >= clip.start + EPSILON,
    )
    .sort((a, b) => a.start - b.start)[0];
}

function moveIncoming(project: Project, incoming: Clip, start: number): Project {
  const delta = start - incoming.start;
  const ids = withLinked(project, [incoming.id]);
  return {
    ...project,
    clips: project.clips.map((clip) =>
      ids.has(clip.id) ? { ...clip, start: clip.start + delta } : clip,
    ),
  };
}

/**
 * Joins a video clip to the next clip on its track. The incoming clip and its linked sound move
 * back over the outgoing one, so the overlap is real footage from both selected ranges.
 */
export function addDissolve(
  project: Project,
  clipId: string,
  seconds = DEFAULT_DISSOLVE_SECONDS,
): EditResult {
  const outgoing = project.clips.find((clip) => clip.id === clipId);
  if (!outgoing || !isVisualClip(outgoing)) return { error: "Select a clip on a video track." };
  const incoming = nextNeighbour(project, outgoing);
  if (!incoming) return { error: "A dissolve needs a following clip on the same track." };
  if (findTransition(project, incoming.id).some((t) => t.to_clip_id === incoming.id)) {
    return { error: "Those clips already dissolve into each other." };
  }
  const locked = lockedTrackOf(project, withLinked(project, [outgoing.id, incoming.id]));
  if (locked) return { error: lockedMessage(locked) };
  const overlap = Math.min(seconds, outgoing.duration / 2, incoming.duration / 2);
  const moved = moveIncoming(project, incoming, clipEnd(outgoing) - overlap);
  const transition: VideoProjectTransition = {
    id: newId(),
    from_clip_id: outgoing.id,
    to_clip_id: incoming.id,
  };
  const result = finish({ ...moved, transitions: [...moved.transitions, transition] });
  return result.error
    ? { error: `The incoming clip cannot move back over the outgoing one: ${result.error}` }
    : result;
}

/** A dissolve is as long as the overlap; changing it slides the incoming clip and its sound. */
export function setDissolveDuration(
  project: Project,
  transitionId: string,
  seconds: number,
): EditResult {
  const transition = project.transitions.find((t) => t.id === transitionId);
  if (!transition) return { error: "That dissolve is gone." };
  const outgoing = project.clips.find((clip) => clip.id === transition.from_clip_id);
  const incoming = project.clips.find((clip) => clip.id === transition.to_clip_id);
  if (!outgoing || !incoming) return { error: "That dissolve is gone." };
  const longest = Math.min(outgoing.duration, incoming.duration) - MIN_CLIP_SECONDS;
  const overlap = Math.max(MIN_CLIP_SECONDS, Math.min(seconds, longest));
  const result = finish(moveIncoming(project, incoming, clipEnd(outgoing) - overlap));
  if (result.project && !result.project.transitions.some((t) => t.id === transitionId)) {
    return { error: "The dissolve cannot be that long." };
  }
  return result;
}

/** Slides the incoming clip forward until the two clips just meet again. */
export function removeDissolve(project: Project, transitionId: string): EditResult {
  const transition = project.transitions.find((t) => t.id === transitionId);
  if (!transition) return { error: "That dissolve is gone." };
  const outgoing = project.clips.find((clip) => clip.id === transition.from_clip_id);
  const incoming = project.clips.find((clip) => clip.id === transition.to_clip_id);
  const without = { ...project, transitions: project.transitions.filter((t) => t !== transition) };
  if (!outgoing || !incoming) return finish(without);
  const result = finish(moveIncoming(without, incoming, clipEnd(outgoing)));
  return result.error
    ? { error: `The clip after the dissolve has no room to move back: ${result.error}` }
    : result;
}

/** Where a new clip can go: the first track of the kind, bottom-most video first, that is free. */
export function freeTrackAt(
  project: Project,
  kind: VideoProjectTrackKind,
  start: number,
  duration: number,
  preferred?: string,
): Track | undefined {
  const ordered = tracksOfKind(project, kind);
  const stacked = kind === "video" ? [...ordered].reverse() : ordered;
  const candidates = preferred
    ? [...stacked.filter((t) => t.id === preferred), ...stacked.filter((t) => t.id !== preferred)]
    : stacked;
  return candidates.find(
    (track) =>
      !track.locked &&
      !project.clips.some(
        (clip) =>
          clip.track_id === track.id &&
          clip.start < start + duration - EPSILON &&
          clipEnd(clip) > start + EPSILON,
      ),
  );
}

export interface PlaceSourceRequest {
  info: VideoProjectSourceInfo;
  start: number;
  /** Source seconds; video and audio only. */
  rangeIn?: number;
  rangeOut?: number;
  /** A drop names its track; an explicit add lets the first free one take it. */
  trackId?: string;
}

function sourceMatches(source: VideoProjectSource, info: VideoProjectSourceInfo): boolean {
  return source.size === info.size && source.modified_us === info.modified_us;
}

/** The project's record of a file, added when it is new; a changed file must be accepted first. */
export function sourceEntry(
  project: Project,
  info: VideoProjectSourceInfo,
): { source: VideoProjectSource; sources: VideoProjectSource[] } | { error: string } {
  const existing = project.sources.find((item) => item.name === info.name);
  if (existing && !sourceMatches(existing, info)) {
    return { error: `${info.name} changed since it was added. Accept the change first.` };
  }
  if (existing) return { source: existing, sources: project.sources };
  const source: VideoProjectSource = {
    id: newId(),
    name: info.name,
    kind: info.kind,
    size: info.size,
    modified_us: info.modified_us,
    duration: info.duration ?? null,
    width: info.width ?? null,
    height: info.height ?? null,
    frame_rate: info.frame_rate ?? null,
    has_audio: info.has_audio,
  };
  return { source, sources: [...project.sources, source] };
}

/** The part of a file a placement takes: a timed file's marked range, or a still's default. */
export function takeOf(
  info: VideoProjectSourceInfo,
  wantedIn?: number,
  wantedOut?: number,
): { rangeIn: number; duration: number } {
  if (info.kind === "image") return { rangeIn: 0, duration: STILL_SECONDS };
  const total = info.duration ?? STILL_SECONDS;
  const rangeIn = Math.max(0, Math.min(wantedIn ?? 0, total));
  const rangeOut = Math.max(rangeIn, Math.min(wantedOut ?? total, total));
  return { rangeIn, duration: rangeOut - rangeIn };
}

/**
 * Places a file from the project's folder. A video with sound brings a linked audio clip. The
 * file is referenced, never copied.
 */
export function placeSource(
  project: Project,
  request: PlaceSourceRequest,
): EditResult & {
  placed?: string[];
} {
  const { info } = request;
  const entry = sourceEntry(project, info);
  if ("error" in entry) return entry;
  const { source, sources } = entry;
  const { rangeIn, duration } = takeOf(info, request.rangeIn, request.rangeOut);
  if (duration < MIN_CLIP_SECONDS) return { error: "Choose a longer range to add." };
  const start = Math.max(0, request.start);

  const kind: VideoProjectTrackKind = info.kind === "audio" ? "audio" : "video";
  const preferredTrack = request.trackId ? trackById(project, request.trackId) : undefined;
  if (preferredTrack && preferredTrack.kind !== kind) {
    return {
      error: kind === "audio" ? "Drop sound on an audio track." : "Drop pictures on a video track.",
    };
  }
  if (preferredTrack?.locked) return { error: lockedMessage(preferredTrack) };
  const track = preferredTrack ?? freeTrackAt(project, kind, start, duration);
  if (!track) {
    return {
      error: `No ${kind} track is free at ${formatTimecode(start, project.frame_rate)}. Move the playhead or add a track.`,
    };
  }

  const link = info.kind === "video" && info.has_audio ? newId() : null;
  const main: Clip = {
    id: newId(),
    track_id: track.id,
    kind: info.kind,
    source_id: source.id,
    start,
    duration,
    source_in: rangeIn,
    speed: 1,
    link_id: link,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    crop: null,
    fit: "fit",
    adjust: restingAdjust(),
    gain: 1,
    fade_in: 0,
    fade_out: 0,
    fade_curve: "equal_power",
    title: null,
    keyframes: noKeyframes(),
  };
  const clips = [main];
  if (link) {
    const audioTrack = freeTrackAt(project, "audio", start, duration);
    if (!audioTrack) {
      return { error: "No audio track is free for this video's sound. Add an audio track." };
    }
    clips.push({ ...main, id: newId(), track_id: audioTrack.id, kind: "audio" });
  }
  const placedProject = { ...project, sources, clips: [...project.clips, ...clips] };
  const result = finish(adoptFirstVideo(placedProject, source));
  return result.project ? { project: result.project, placed: clips.map((c) => c.id) } : result;
}

/**
 * A project opened empty takes its canvas, rate and name from the first video placed in it,
 * as one started on that video would have.
 */
function adoptFirstVideo(project: Project, source: VideoProjectSource): Project {
  if (project.initial_source_id || source.kind !== "video") return project;
  if (project.clips.some((clip) => clip.source_id && clip.source_id !== source.id)) return project;
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  return {
    ...project,
    initial_source_id: source.id,
    width: source.width ? even(source.width) : project.width,
    height: source.height ? even(source.height) : project.height,
    frame_rate: source.frame_rate
      ? Math.round(source.frame_rate * 1000) / 1000
      : project.frame_rate,
    name:
      project.name === VIDEO_PROJECT_UNTITLED_NAME
        ? `${source.name.replace(/\.[^.]+$/, "")} edit`
        : project.name,
  };
}

/** A title goes on the top-most video track that is free at ``start``. */
export function addTitle(
  project: Project,
  start: number,
  trackId?: string,
): EditResult & { placed?: string[] } {
  const track = trackId
    ? trackById(project, trackId)
    : tracksOfKind(project, "video").find(
        (candidate) =>
          freeTrackAt(project, "video", start, TITLE_SECONDS, candidate.id)?.id === candidate.id,
      );
  if (!track || track.kind !== "video") {
    return {
      error: `No video track is free at ${formatTimecode(start, project.frame_rate)} for a title.`,
    };
  }
  const clip: Clip = {
    id: newId(),
    track_id: track.id,
    kind: "title",
    source_id: null,
    start,
    duration: TITLE_SECONDS,
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
    keyframes: noKeyframes(),
    title: {
      text: "Title",
      size: 0.08,
      color: "#ffffff",
      align: "center",
      x: 0.5,
      y: 0.5,
      outline: 0.04,
      outline_color: "#000000",
    },
  };
  const result = finish({ ...project, clips: [...project.clips, clip] });
  return result.project ? { project: result.project, placed: [clip.id] } : result;
}

export function restingAdjust() {
  return {
    exposure: 0,
    brilliance: 0,
    highlights: 0,
    shadows: 0,
    contrast: 0,
    brightness: 0,
    black_point: 0,
    white_point: 0,
    saturation: 0,
    vibrance: 0,
    warmth: 0,
    tint: 0,
    hue: 0,
    definition: 0,
    noise_reduction: 0,
  };
}

function nextTrackName(project: Project, kind: VideoProjectTrackKind): string {
  const prefix = kind === "video" ? "V" : "A";
  const used = new Set(project.tracks.map((track) => track.name));
  for (let index = 1; ; index += 1) {
    if (!used.has(`${prefix}${index}`)) return `${prefix}${index}`;
  }
}

/** A new video track goes on top of the stack; a new audio track at the bottom. */
export function addTrack(project: Project, kind: VideoProjectTrackKind): EditResult {
  if (project.tracks.length >= VIDEO_PROJECT_MAX_TRACKS) {
    return { error: `A project holds at most ${VIDEO_PROJECT_MAX_TRACKS} tracks.` };
  }
  const track: Track = {
    id: newId(),
    kind,
    name: nextTrackName(project, kind),
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    gain: 1,
    speech: false,
    sync_lock: true,
    collapsed: false,
  };
  const tracks = kind === "video" ? [track, ...project.tracks] : [...project.tracks, track];
  return { project: { ...project, tracks } };
}

export function removeTrack(project: Project, trackId: string): EditResult {
  const track = trackById(project, trackId);
  if (!track) return { error: "That track is gone." };
  if (project.clips.some((clip) => clip.track_id === trackId)) {
    return { error: `${track.name} still holds clips. Only an empty track can be removed.` };
  }
  if (tracksOfKind(project, track.kind).length <= 1) {
    return { error: `The project keeps at least one ${track.kind} track.` };
  }
  return { project: { ...project, tracks: project.tracks.filter((item) => item.id !== trackId) } };
}

/** Steps a track up or down among the tracks of its own kind. */
export function moveTrack(project: Project, trackId: string, direction: -1 | 1): EditResult {
  const index = project.tracks.findIndex((track) => track.id === trackId);
  const swap = index + direction;
  const track = project.tracks[index];
  const other = project.tracks[swap];
  if (!track || !other || other.kind !== track.kind) {
    return { error: `${track?.name ?? "That track"} is already at the edge of its group.` };
  }
  const tracks = [...project.tracks];
  tracks[index] = other;
  tracks[swap] = track;
  return { project: { ...project, tracks } };
}

export function updateTrack(project: Project, trackId: string, patch: Partial<Track>): EditResult {
  return {
    project: {
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    },
  };
}

/**
 * Every clip that starts at or after ``time``, on ``trackIds`` when given: what to select to move
 * the rest of the edit along.
 */
export function clipsFrom(project: Project, time: number, trackIds?: Set<string>): Set<string> {
  return new Set(
    project.clips
      .filter((clip) => clip.start >= time - EPSILON && (!trackIds || trackIds.has(clip.track_id)))
      .map((clip) => clip.id),
  );
}

/** Clip edges, markers and the playhead a dragged time snaps to, except the moved clips' own. */
export function snapTargets(project: Project, playhead: number, excluding: Set<string>): number[] {
  const targets = [0, playhead, ...project.markers.map((marker) => marker.time)];
  for (const clip of project.clips) {
    if (excluding.has(clip.id)) continue;
    targets.push(clip.start, clipEnd(clip));
  }
  return targets;
}

/** The nearest target within ``threshold`` seconds, or null. */
export function snapTo(time: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const target of targets) {
    const distance = Math.abs(target - time);
    if (distance <= threshold && (best === null || distance < Math.abs(best - time))) {
      best = target;
    }
  }
  return best;
}

/** Snaps a moving block by whichever of its two edges lands closer to a target. */
export function snapBlockDelta(
  start: number,
  end: number,
  delta: number,
  targets: number[],
  threshold: number,
): number {
  const fromStart = snapTo(start + delta, targets, threshold);
  const fromEnd = snapTo(end + delta, targets, threshold);
  const startShift = fromStart === null ? null : fromStart - start;
  const endShift = fromEnd === null ? null : fromEnd - end;
  if (startShift === null) return endShift ?? delta;
  if (endShift === null) return startShift;
  return Math.abs(startShift - delta) <= Math.abs(endShift - delta) ? startShift : endShift;
}

/**
 * `MM:SS`, or with a rate `HH:MM:SS:FF`: four fields, so frames never read as seconds. Frames
 * are counted to the nearest one, as `snapToFrame` places them, so a step always reads as one.
 */
export function formatTimecode(seconds: number, frameRate?: number): string {
  const safe = Math.max(0, seconds);
  const two = (value: number) => String(value).padStart(2, "0");
  if (!frameRate) {
    return `${two(Math.floor(safe / 60))}:${two(Math.floor(safe % 60))}`;
  }
  const perSecond = Math.max(1, Math.round(frameRate));
  const frames = Math.round(safe * frameRate);
  const whole = Math.floor(frames / perSecond);
  const frame = frames - whole * perSecond;
  const minutes = Math.floor(whole / 60);
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}:${two(whole % 60)}:${two(frame)}`;
}
