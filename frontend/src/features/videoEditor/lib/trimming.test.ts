import { describe, expect, it } from "vitest";
import { makeClip, makeProject, makeSource, makeTrack } from "@/test/videoProject";
import { addMarker, markerBeside, removeMarker, updateMarker } from "./markers";
import { rippleTrim, rippleTrimToPlayhead, rollTrim } from "./trimming";
import { clipsFrom, rippleDelete, snapTargets, type Clip, type Project } from "./timeline";

function clip(project: Project, id: string): Clip {
  const found = project.clips.find((item) => item.id === id);
  if (!found) throw new Error(`no clip ${id}`);
  return found;
}

/** Two stills on V1 that touch at 2 s, and a still on V2 from 2 s. */
function touching(patch: Partial<Project> = {}): Project {
  return makeProject({
    clips: [
      makeClip("first", "v1", 0, 2),
      makeClip("second", "v1", 2, 2),
      makeClip("above", "v2", 2, 1),
    ],
    ...patch,
  });
}

describe("rippleTrim", () => {
  it("shortens the end and pulls everything after the clip back on synced tracks", () => {
    const result = rippleTrim(touching(), "first", "end", 1.5);

    const next = result.project as Project;
    expect(clip(next, "first").duration).toBeCloseTo(1.5);
    expect(clip(next, "second").start).toBeCloseTo(1.5);
    expect(clip(next, "above").start).toBeCloseTo(1.5);
  });

  it("lengthens the end and leaves a track with sync lock off where it is", () => {
    const project = touching({
      tracks: [
        makeTrack("v2", "video", { sync_lock: false }),
        makeTrack("v1", "video"),
        makeTrack("a1", "audio"),
      ],
    });

    const next = rippleTrim(project, "first", "end", 2.5).project as Project;

    expect(clip(next, "first").duration).toBeCloseTo(2.5);
    expect(clip(next, "second").start).toBeCloseTo(2.5);
    expect(clip(next, "above").start).toBeCloseTo(2);
  });

  it("trims the start inside the take while the clip stays where it starts", () => {
    const project = makeProject({
      sources: [makeSource("film", "film.mp4", "video", { duration: 8 })],
      clips: [
        makeClip("shot", "v1", 1, 2, { kind: "video", source_id: "film", source_in: 1 }),
        makeClip("next", "v1", 3, 1, { kind: "video", source_id: "film" }),
      ],
    });

    const next = rippleTrim(project, "shot", "start", 1.5).project as Project;

    expect(clip(next, "shot")).toMatchObject({ start: 1, source_in: 1.5 });
    expect(clip(next, "shot").duration).toBeCloseTo(1.5);
    expect(clip(next, "next").start).toBeCloseTo(2.5);
    // A head trim can reveal no more of the take than the file has before the in point.
    const revealed = rippleTrim(project, "shot", "start", 0).project as Project;
    expect(clip(revealed, "shot")).toMatchObject({ start: 1, source_in: 0, duration: 3 });
    expect(clip(revealed, "next").start).toBeCloseTo(4);
  });

  it("refuses to push a synced track's clips into one another, naming the way out", () => {
    const project = touching({
      clips: [
        makeClip("first", "v1", 0, 2),
        makeClip("long", "v2", 1, 1.5),
        makeClip("after", "v2", 2.5, 1),
      ],
    });

    const result = rippleTrim(project, "first", "end", 1);

    expect(result.error).toMatch(/turn off sync lock on V2/);
  });

  it("refuses an edge inside a dissolve and a locked track it would move", () => {
    const dissolved = makeProject({
      clips: [makeClip("a", "v1", 0, 2), makeClip("b", "v1", 1.5, 2)],
      transitions: [{ id: "d", from_clip_id: "a", to_clip_id: "b" }],
    });
    expect(rippleTrim(dissolved, "a", "end", 1).error).toMatch(/dissolve or crossfade/);

    const locked = touching({
      tracks: [
        makeTrack("v2", "video", { locked: true }),
        makeTrack("v1", "video"),
        makeTrack("a1", "audio"),
      ],
    });
    expect(rippleTrim(locked, "first", "end", 1).error).toMatch(/V2, which is locked/);
  });

  it("ripple trims the clip under the playhead to it", () => {
    const next = rippleTrimToPlayhead(touching(), [], 0.5, "start").project as Project;

    expect(clip(next, "first")).toMatchObject({ start: 0 });
    expect(clip(next, "first").duration).toBeCloseTo(1.5);
    expect(clip(next, "second").start).toBeCloseTo(1.5);
  });
});

describe("rollTrim", () => {
  it("moves the cut between two touching clips and nothing else", () => {
    const next = rollTrim(touching(), "first", "end", 2.5).project as Project;

    expect(clip(next, "first").duration).toBeCloseTo(2.5);
    expect(clip(next, "second").start).toBeCloseTo(2.5);
    expect(clip(next, "second").duration).toBeCloseTo(1.5);
    expect(clip(next, "above").start).toBeCloseTo(2);
  });

  it("stops where either side runs out, and trims a free edge as usual", () => {
    const project = makeProject({
      sources: [makeSource("film", "film.mp4", "video", { duration: 3 })],
      clips: [
        makeClip("a", "v1", 0, 2, { kind: "video", source_id: "film", source_in: 0 }),
        makeClip("b", "v1", 2, 2),
      ],
    });

    const rolled = rollTrim(project, "b", "start", 3.8).project as Project;
    // The take holds 3 s, so the cut cannot pass 3 s however far the pointer goes.
    expect(clipEndOf(rolled, "a")).toBeCloseTo(3);
    expect(clip(rolled, "b").start).toBeCloseTo(3);

    const free = rollTrim(project, "b", "end", 5).project as Project;
    expect(clip(free, "b").duration).toBeCloseTo(3);
  });
});

function clipEndOf(project: Project, id: string): number {
  const found = clip(project, id);
  return found.start + found.duration;
}

describe("sync lock", () => {
  it("keeps a track with sync lock off out of a ripple delete", () => {
    const project = touching({
      tracks: [
        makeTrack("v2", "video", { sync_lock: false }),
        makeTrack("v1", "video"),
        makeTrack("a1", "audio"),
      ],
    });

    const next = rippleDelete(project, { start: 0.5, end: 1.5 }).project as Project;

    expect(clip(next, "second").start).toBeCloseTo(1);
    expect(clip(next, "above").start).toBeCloseTo(2);
  });
});

describe("markers", () => {
  it("adds markers in time order, one per frame, and steps between them", () => {
    let project = makeProject();
    project = addMarker(project, 2, "Drop").project as Project;
    project = addMarker(project, 1).project as Project;

    expect(project.markers.map((marker) => marker.time)).toEqual([1, 2]);
    expect(addMarker(project, 2.01).error).toMatch(/already a marker/);
    expect(markerBeside(project, 1, 1)?.name).toBe("Drop");
    expect(markerBeside(project, 1.5, -1)?.time).toBe(1);
    expect(snapTargets(project, 0, new Set())).toEqual(expect.arrayContaining([1, 2]));

    const moved = updateMarker(project, project.markers[0].id, { time: 3 }).project as Project;
    expect(moved.markers.map((marker) => marker.time)).toEqual([2, 3]);
    expect(removeMarker(moved, moved.markers[0].id).project?.markers).toHaveLength(1);
  });
});

describe("clipsFrom", () => {
  it("chooses the clips starting at or after a time, on the given tracks", () => {
    expect(clipsFrom(touching(), 2)).toEqual(new Set(["second", "above"]));
    expect(clipsFrom(touching(), 2, new Set(["v1"]))).toEqual(new Set(["second"]));
  });
});
