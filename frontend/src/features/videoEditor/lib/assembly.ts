/**
 * Edits for revising an assembled cut: replacing a take in its slot, inserting material, and
 * exact, frame-based moves and trims. Each one returns the next project or why it cannot be made,
 * like the operations in `timeline.ts`, so the workspace commits it as one undo step.
 */
import type { VideoProjectSourceInfo } from "@/shared/types";
import { SPEED_PRESETS } from "@/features/gallery/lib/videoEdit";
import {
  clampFades,
  clipEnd,
  clipLabel,
  EPSILON,
  finish,
  freeTrackAt,
  lockedMessage,
  lockedTrackOf,
  MIN_CLIP_SECONDS,
  moveClips,
  newId,
  placeSource,
  pruneTransitions,
  rippleScope,
  sourceById,
  sourceEntry,
  splitClips,
  takeOf,
  trackById,
  trimClip,
  withLinked,
  type Clip,
  type EditResult,
  type PlaceSourceRequest,
  type Project,
  type TrimEdge,
} from "./timeline";

export const MIN_SPEED = SPEED_PRESETS[0];
export const MAX_SPEED = SPEED_PRESETS[SPEED_PRESETS.length - 1];

/**
 * What a replacement does with a take whose length differs from the slot.
 * - ``keep-speed``: the clip keeps its speed. A longer take is cut to the slot; a shorter one
 *   shortens the clip from its end, leaving a gap, never moving a neighbour.
 * - ``fit-to-fill``: the clip keeps its slot exactly and the marked range is retimed to fill it.
 */
export type ReplacePolicy = "keep-speed" | "fit-to-fill";

export interface ReplaceRequest {
  info: VideoProjectSourceInfo;
  /** Source seconds, as marked in the source monitor. */
  rangeIn?: number;
  rangeOut?: number;
  policy: ReplacePolicy;
}

export type NotedResult = EditResult & { note?: string };

/**
 * Puts another file in a clip's place. Its start, track, link, transform, crop, color, gain,
 * fades and dissolves stay; only the take changes. A linked video's sound follows the new file:
 * replaced when it has sound, removed when it has none, added when only the new one has it.
 */
export function replaceClip(
  project: Project,
  clipId: string,
  request: ReplaceRequest,
): NotedResult {
  const anchor = project.clips.find((clip) => clip.id === clipId);
  if (!anchor) return { error: "Select the clip to replace." };
  if (anchor.kind === "title") return { error: "A title has no file to replace; edit its text." };
  const { info } = request;
  const visual = anchor.kind !== "audio";
  if (visual && info.kind === "audio") return { error: "Replace a picture with a video or image." };
  if (!visual && (info.kind === "image" || (info.kind === "video" && !info.has_audio))) {
    return { error: `${info.name} has no sound to replace an audio clip with.` };
  }
  const group = withLinked(project, [clipId]);
  if (!visual && project.clips.some((clip) => group.has(clip.id) && clip.kind === "video")) {
    return { error: "Select the video to replace a linked take, or unlink its sound first." };
  }
  const locked = lockedTrackOf(project, group);
  if (locked) return { error: lockedMessage(locked) };
  const entry = sourceEntry(project, info);
  if ("error" in entry) return entry;
  const { source, sources } = entry;

  const still = info.kind === "image";
  let speed = 1;
  let duration = anchor.duration;
  let rangeIn = 0;
  let note: string | undefined;
  if (!still) {
    const take = takeOf(info, request.rangeIn, request.rangeOut);
    rangeIn = take.rangeIn;
    if (request.policy === "fit-to-fill") {
      speed = take.duration / anchor.duration;
      if (speed < MIN_SPEED - 1e-6 || speed > MAX_SPEED + 1e-6) {
        return {
          error:
            `Fitting ${take.duration.toFixed(2)} s of ${info.name} into ${anchor.duration.toFixed(2)} s ` +
            `would play it at ${speed.toFixed(2)}×, outside ${MIN_SPEED}× to ${MAX_SPEED}×. Mark a ` +
            "range closer to the clip's length.",
        };
      }
    } else {
      speed = anchor.kind === "image" ? 1 : anchor.speed;
      const needed = anchor.duration * speed;
      if (take.duration < needed - EPSILON) {
        duration = take.duration / speed;
        note =
          `${info.name} is ${(anchor.duration - duration).toFixed(2)} s shorter than the clip, so ` +
          "the clip ends earlier and leaves a gap. Use Fit to fill to keep its length.";
      }
    }
    if (duration < MIN_CLIP_SECONDS) return { error: "Choose a longer range to replace with." };
  }

  const kind = visual ? (still ? "image" : "video") : "audio";
  const replaced = (clip: Clip): Clip =>
    clampFades({
      ...clip,
      kind: clip.kind === "audio" ? "audio" : kind,
      source_id: source.id,
      source_in: still && clip.kind !== "audio" ? 0 : rangeIn,
      speed,
      duration,
    });
  const brings = info.kind === "video" && info.has_audio;
  const clips: Clip[] = [];
  let soundKept = false;
  for (const clip of project.clips) {
    if (!group.has(clip.id)) clips.push(clip);
    else if (clip.id === anchor.id) clips.push(replaced(clip));
    else if (clip.kind === "audio" && brings) {
      clips.push(replaced(clip));
      soundKept = true;
    } else if (clip.kind !== "audio") clips.push(clip);
  }

  let link = anchor.link_id;
  if (visual && brings && !soundKept) {
    const track = freeTrackAt({ ...project, clips }, "audio", anchor.start, duration);
    if (track) {
      link ??= newId();
      clips.push({ ...replaced(anchor), id: newId(), kind: "audio", track_id: track.id });
    } else {
      note = `${note ? `${note} ` : ""}Its sound was left out: no audio track is free there.`;
    }
  }
  // The new sound joins the anchor's link; an anchor whose sound went away is unlinked.
  const fresh = new Set(
    clips
      .filter((clip) => !group.has(clip.id) && !project.clips.includes(clip))
      .map((clip) => clip.id),
  );
  const partnered = clips.some(
    (clip) =>
      clip.id !== anchor.id && (fresh.has(clip.id) || (link !== null && clip.link_id === link)),
  );
  const final = partnered ? link : null;
  const relinked = clips.map((clip) =>
    clip.id === anchor.id || fresh.has(clip.id) ? { ...clip, link_id: final } : clip,
  );

  const next: Project = { ...project, sources, clips: relinked };
  const pruned = pruneTransitions(next);
  if (pruned.transitions.length < next.transitions.length) {
    return {
      error:
        `${info.name} is too short to keep this clip's dissolve. Use Fit to fill, or mark a ` +
        "longer range.",
    };
  }
  const result = finish(next);
  return result.project ? { project: result.project, note } : result;
}

/**
 * Opens room at ``time`` on every track with sync lock on and places the file there, so
 * everything after it moves later together. Clips crossing ``time`` are cut, as a split there
 * would cut them.
 */
export function insertSource(
  project: Project,
  request: PlaceSourceRequest,
): EditResult & { placed?: string[] } {
  const time = Math.max(0, request.start);
  const { duration } = takeOf(request.info, request.rangeIn, request.rangeOut);
  if (duration < MIN_CLIP_SECONDS) return { error: "Choose a longer range to insert." };
  const opened = openGap(project, time, duration);
  if (!opened.project) return opened;
  return placeSource(opened.project, { ...request, start: time });
}

/**
 * Moves every clip in the ripple scope from ``time`` on later by ``length``; refused if a locked
 * track would move.
 */
export function openGap(project: Project, time: number, length: number): EditResult {
  const scope = rippleScope(project);
  const moving = project.clips.filter(
    (clip) => scope.has(clip.id) && clipEnd(clip) > time + EPSILON,
  );
  const locked = moving
    .map((clip) => trackById(project, clip.track_id))
    .find((track) => track?.locked);
  if (locked) {
    return {
      error: `Inserting would move clips on ${locked.name}, which is locked. Unlock it first.`,
    };
  }
  let current = project;
  const crossing = moving.filter((clip) => clip.start < time - EPSILON);
  if (crossing.length > 0) {
    const cut = splitClips(
      project,
      time,
      crossing.map((clip) => clip.id),
    );
    if (!cut.project) return cut;
    current = cut.project;
  }
  // The cut's right halves have new ids, so the scope is read again after it.
  const shifted = rippleScope(current);
  return {
    project: {
      ...current,
      clips: current.clips.map((clip) =>
        clip.start >= time - EPSILON && shifted.has(clip.id)
          ? { ...clip, start: clip.start + length }
          : clip,
      ),
    },
  };
}

/** Moves the chosen clips, and what is linked to them, by whole frames. */
export function nudgeClips(
  project: Project,
  ids: Iterable<string>,
  frames: number,
  frameRate: number,
): EditResult {
  const chosen = [...ids];
  if (chosen.length === 0) return { error: "Select clips to nudge." };
  const result = moveClips(project, { ids: chosen, delta: frames / frameRate });
  return result.error ? { error: `They cannot move there: ${result.error}` } : result;
}

/**
 * Brings one edge of each chosen clip under the playhead to it. Without a choice, every clip under
 * the playhead on an unlocked track is trimmed, as a split without one cuts them all.
 */
export function trimToPlayhead(
  project: Project,
  ids: Iterable<string>,
  time: number,
  edge: TrimEdge,
): EditResult {
  const chosen = new Set(ids);
  const under = project.clips.filter(
    (clip) =>
      clip.start + MIN_CLIP_SECONDS - EPSILON < time &&
      time < clipEnd(clip) - MIN_CLIP_SECONDS + EPSILON &&
      (chosen.size > 0 ? chosen.has(clip.id) : !trackById(project, clip.track_id)?.locked),
  );
  if (under.length === 0) {
    return { error: "The playhead is not inside a clip to trim. Move it over the clip first." };
  }
  let current = project;
  const done = new Set<string>();
  for (const clip of under) {
    if (done.has(clip.id)) continue;
    for (const id of withLinked(current, [clip.id])) done.add(id);
    const result = trimClip(current, clip.id, edge, time);
    if (!result.project) return result;
    current = result.project;
  }
  return { project: current };
}

/** Moves a clip, and what is linked to it, so it starts exactly at ``start``. */
export function setClipStart(project: Project, id: string, start: number): EditResult {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return { error: "That clip is gone." };
  if (start < 0) return { error: "A clip cannot start before 00:00." };
  return moveClips(project, { ids: [id], delta: start - clip.start });
}

/** Sets a clip's length exactly; a take that cannot reach it is refused, never cut short. */
export function setClipLength(project: Project, id: string, duration: number): EditResult {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return { error: "That clip is gone." };
  if (duration < MIN_CLIP_SECONDS - EPSILON) return { error: "That would leave a clip too short." };
  const result = trimClip(project, id, "end", clip.start + duration);
  if (!result.project) return result;
  const after = result.project.clips.find((item) => item.id === id);
  if (after && after.duration < duration - EPSILON) {
    return {
      error: `${clipLabel(project, clip)} runs out after ${after.duration.toFixed(2)} s from its in point.`,
    };
  }
  return result;
}

/**
 * Slips the take: the clip stays where it is and as long, and shows the file from ``sourceIn``.
 * Linked clips slip with it, so picture and sound stay together.
 */
export function slipClip(project: Project, id: string, sourceIn: number): EditResult {
  const anchor = project.clips.find((item) => item.id === id);
  if (!anchor) return { error: "That clip is gone." };
  if (anchor.kind !== "video" && anchor.kind !== "audio") {
    return { error: "Only video and sound have an in point." };
  }
  const group = withLinked(project, [id]);
  const locked = lockedTrackOf(project, group);
  if (locked) return { error: lockedMessage(locked) };
  const delta = sourceIn - anchor.source_in;
  const changed: Clip[] = [];
  for (const clip of project.clips) {
    if (!group.has(clip.id) || (clip.kind !== "video" && clip.kind !== "audio")) {
      changed.push(clip);
      continue;
    }
    const next = clip.source_in + delta;
    const total = sourceById(project, clip.source_id)?.duration ?? Infinity;
    const latest = total - clip.duration * clip.speed;
    if (next < -EPSILON || next > latest + EPSILON) {
      return {
        error: `The in point must lie between 0 and ${Math.max(0, latest).toFixed(2)} s of the file, so the take fits the clip.`,
      };
    }
    changed.push({ ...clip, source_in: Math.min(Math.max(0, next), Math.max(0, latest)) });
  }
  return finish({ ...project, clips: changed });
}

/**
 * Applies ``patch`` to every chosen clip it fits; ``patch`` returns null for a clip it does not
 * apply to. Used to set one inspector value on a whole selection at once.
 */
export function updateClips(
  project: Project,
  ids: Iterable<string>,
  patch: (clip: Clip) => Partial<Clip> | null,
): EditResult {
  const chosen = new Set(ids);
  const changed = new Map<string, Clip>();
  for (const clip of project.clips) {
    if (!chosen.has(clip.id)) continue;
    const update = patch(clip);
    if (!update) continue;
    const track = trackById(project, clip.track_id);
    if (track?.locked) return { error: lockedMessage(track) };
    changed.set(clip.id, clampFades({ ...clip, ...update }));
  }
  if (changed.size === 0) return { error: "None of the selected clips has that setting." };
  return finish({ ...project, clips: project.clips.map((clip) => changed.get(clip.id) ?? clip) });
}

/** Sets the length of every chosen still and title; timed clips keep the length of their take. */
export function setClipsLength(
  project: Project,
  ids: Iterable<string>,
  duration: number,
): EditResult {
  let current = project;
  let any = false;
  for (const id of ids) {
    const clip = current.clips.find((item) => item.id === id);
    if (!clip || (clip.kind !== "image" && clip.kind !== "title")) continue;
    any = true;
    const result = setClipLength(current, id, duration);
    if (!result.project) return result;
    current = result.project;
  }
  return any ? { project: current } : { error: "Only stills and titles take a set length." };
}
