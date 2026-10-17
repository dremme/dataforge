/**
 * Trims that keep the cut's timing: a ripple trim closes or opens the time it changes by moving
 * everything after the clip, and a roll trim moves one cut between two touching clips. Each
 * returns the next project or why it cannot be made, like the operations in `timeline.ts`.
 */
import { shiftKeyframes } from "./keyframes";
import {
  clampFades,
  clampTravel,
  clipEnd,
  clipLabel,
  edgeTravel,
  EPSILON,
  finish,
  isTimedClip,
  lockedMessage,
  lockedTrackOf,
  MIN_CLIP_SECONDS,
  rippleScope,
  trackById,
  trimClip,
  trimClipFlush,
  withLinked,
  type Clip,
  type EditResult,
  type Project,
  type TrimEdge,
} from "./timeline";

/** Every pair of clips on one track that overlaps, keyed by their ids. */
function overlappingPairs(project: Project): Set<string> {
  const pairs = new Set<string>();
  for (const track of project.tracks) {
    const clips = project.clips
      .filter((clip) => clip.track_id === track.id)
      .sort((a, b) => a.start - b.start);
    for (let index = 0; index < clips.length; index += 1) {
      for (let later = index + 1; later < clips.length; later += 1) {
        if (clips[later].start >= clipEnd(clips[index]) - EPSILON) break;
        pairs.add([clips[index].id, clips[later].id].sort().join("|"));
      }
    }
  }
  return pairs;
}

/**
 * Pushing clips along must never make a new overlap: on a video track it would be refused
 * anyway, but on an audio track it would quietly become a crossfade.
 */
function pushedTogether(before: Project, after: Project): string | null {
  const existing = overlappingPairs(before);
  for (const pair of overlappingPairs(after)) {
    if (existing.has(pair)) continue;
    const [first, second] = pair.split("|").map((id) => after.clips.find((c) => c.id === id));
    if (!first || !second) continue;
    const track = trackById(after, first.track_id);
    const name = track?.name ?? "a track";
    return `The ripple would push ${clipLabel(after, first)} and ${clipLabel(after, second)} together on ${name}. Make room there, or turn off sync lock on ${name} to leave it alone.`;
  }
  return null;
}

/** A dissolve or crossfade on ``edge`` of one of these clips: a ripple there has no one cut. */
function overlapsAtEdge(project: Project, ids: Set<string>, edge: TrimEdge): boolean {
  return project.clips.some((clip) => {
    if (!ids.has(clip.id)) return false;
    return project.clips.some(
      (other) =>
        !ids.has(other.id) &&
        other.track_id === clip.track_id &&
        (edge === "end"
          ? other.start > clip.start && other.start < clipEnd(clip) - EPSILON
          : other.start < clip.start && clipEnd(other) > clip.start + EPSILON),
    );
  });
}

/**
 * Trims one edge of a clip, and what is linked to it, toward ``time`` and moves everything that
 * starts after the clip by the time it gained or lost, so no gap opens and nothing is covered.
 * A start edge changes the take while the clip stays where it starts. Clips after the clip move
 * on its own tracks and on every track with sync lock on.
 */
export function rippleTrim(project: Project, id: string, edge: TrimEdge, time: number): EditResult {
  const anchor = project.clips.find((clip) => clip.id === id);
  if (!anchor) return { error: "That clip is gone." };
  const group = withLinked(project, [id]);
  const locked = lockedTrackOf(project, group);
  if (locked) return { error: lockedMessage(locked) };
  // Either way the clip's end moves, so it has to be a plain cut as well.
  if (overlapsAtEdge(project, group, "end") || overlapsAtEdge(project, group, edge)) {
    return {
      error:
        "That edge is inside a dissolve or crossfade, so it has no single cut to ripple. Remove the overlap first.",
    };
  }

  const from = edge === "start" ? anchor.start : clipEnd(anchor);
  // How far the edge moves against the take; the start stays put, so 00:00 does not bound it.
  const travel = clampTravel(time - from, edgeTravel(project, group, edge, false));
  if (Math.abs(travel) < 1e-9) return { project };
  const change = edge === "start" ? -travel : travel;

  const pivot = clipEnd(anchor);
  const groupTracks = project.clips.filter((c) => group.has(c.id)).map((c) => c.track_id);
  const scope = rippleScope(project, groupTracks);
  const later = withLinked(
    project,
    project.clips
      .filter((clip) => !group.has(clip.id) && scope.has(clip.id))
      .filter((clip) => clip.start >= pivot - EPSILON)
      .map((clip) => clip.id),
  );
  const movedLocked = lockedTrackOf(project, later);
  if (movedLocked) {
    return {
      error: `The ripple would move clips on ${movedLocked.name}, which is locked. Unlock it, or turn off its sync lock.`,
    };
  }

  const clips = project.clips.map((clip): Clip => {
    if (later.has(clip.id)) return { ...clip, start: clip.start + change };
    if (!group.has(clip.id)) return clip;
    if (edge === "end") return clampFades({ ...clip, duration: clip.duration + change });
    return clampFades(
      shiftKeyframes(
        {
          ...clip,
          duration: clip.duration - travel,
          source_in: isTimedClip(clip)
            ? Math.max(0, clip.source_in + travel * clip.speed)
            : clip.source_in,
        },
        travel,
      ),
    );
  });
  const next = { ...project, clips };
  const problem = pushedTogether(project, next);
  return problem ? { error: problem } : finish(next);
}

/** The clip on the same track whose edge touches ``edge`` of ``clip``: the other side of a cut. */
export function rollPartner(project: Project, clip: Clip, edge: TrimEdge): Clip | undefined {
  const group = withLinked(project, [clip.id]);
  return project.clips.find(
    (other) =>
      !group.has(other.id) &&
      other.track_id === clip.track_id &&
      (edge === "end"
        ? Math.abs(other.start - clipEnd(clip)) < EPSILON
        : Math.abs(clipEnd(other) - clip.start) < EPSILON),
  );
}

/**
 * Moves the cut on ``edge`` of a clip to ``time``: the clip and the one it touches there trim
 * together, so the cut slides while everything else keeps its time. An edge that touches no clip
 * trims as usual.
 */
export function rollTrim(project: Project, id: string, edge: TrimEdge, time: number): EditResult {
  const anchor = project.clips.find((clip) => clip.id === id);
  if (!anchor) return { error: "That clip is gone." };
  const partner = rollPartner(project, anchor, edge);
  if (!partner) return trimClipFlush(project, id, edge, time);

  const [outgoing, incoming] = edge === "end" ? [anchor, partner] : [partner, anchor];
  const cut = clipEnd(outgoing);
  const outBounds = edgeTravel(project, withLinked(project, [outgoing.id]), "end");
  const inBounds = edgeTravel(project, withLinked(project, [incoming.id]), "start");
  const travel = clampTravel(time - cut, {
    min: Math.max(outBounds.min, inBounds.min),
    max: Math.min(outBounds.max, inBounds.max),
  });
  if (Math.abs(travel) < 1e-9) return { project };
  const target = cut + travel;
  // The side that shrinks goes first, so the two never cover each other on the way.
  const order: [Clip, TrimEdge][] =
    travel > 0
      ? [
          [incoming, "start"],
          [outgoing, "end"],
        ]
      : [
          [outgoing, "end"],
          [incoming, "start"],
        ];
  let current = project;
  for (const [clip, side] of order) {
    const result = trimClip(current, clip.id, side, target);
    if (!result.project) return result;
    current = result.project;
  }
  return { project: current };
}

/**
 * Ripple trims the clip under the playhead to it: ``start`` removes the part before the playhead
 * and pulls the rest of the clip back to where it started, ``end`` removes the part after it.
 * It acts on the one selected clip there, or else on the topmost clip under the playhead.
 */
export function rippleTrimToPlayhead(
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
  const order = new Map(project.tracks.map((track, index) => [track.id, index]));
  under.sort((a, b) => (order.get(a.track_id) ?? 0) - (order.get(b.track_id) ?? 0));
  const groups = new Set(under.map((clip) => [...withLinked(project, [clip.id])].sort().join()));
  if (chosen.size > 0 && groups.size > 1) {
    return { error: "Select one clip, with its linked sound, to ripple trim." };
  }
  return rippleTrim(project, under[0].id, edge, time);
}
