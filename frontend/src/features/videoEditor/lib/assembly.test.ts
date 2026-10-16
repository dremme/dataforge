import { describe, expect, it } from "vitest";
import type { VideoProjectSourceInfo } from "@/shared/types";
import { makeClip, makeProject, makeSource, makeTrack } from "@/test/videoProject";
import {
  insertSource,
  nudgeClips,
  replaceClip,
  setClipLength,
  setClipStart,
  setClipsLength,
  slipClip,
  trimToPlayhead,
  updateClips,
} from "./assembly";
import { restingAdjust, type Clip, type Project } from "./timeline";

function info(name: string, patch: Partial<VideoProjectSourceInfo> = {}): VideoProjectSourceInfo {
  return {
    path: `/media/${name}`,
    name,
    kind: "video",
    size: 1,
    modified_us: 1,
    duration: 10,
    width: 640,
    height: 360,
    frame_rate: 30,
    has_audio: true,
    ...patch,
  };
}

const graded = { ...restingAdjust(), exposure: 0.4 };

/** A 2 s shot at 1 s with linked sound, then a still at 3 s, plus one lone image source. */
function cut(patch: Partial<Project> = {}): Project {
  return makeProject({
    sources: [
      makeSource("film", "film.mp4", "video", { duration: 8 }),
      makeSource("still", "still.png", "image"),
    ],
    clips: [
      makeClip("shot", "v1", 1, 2, {
        kind: "video",
        source_id: "film",
        source_in: 0.5,
        link_id: "l",
        adjust: graded,
        fade_in: 0.2,
        transform: { x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 1 },
      }),
      makeClip("shot-sound", "a1", 1, 2, {
        kind: "audio",
        source_id: "film",
        source_in: 0.5,
        link_id: "l",
        gain: 0.7,
      }),
      makeClip("next", "v1", 3, 2),
    ],
    ...patch,
  });
}

const byId = (project: Project | undefined, id: string): Clip | undefined =>
  project?.clips.find((clip) => clip.id === id);

describe("replaceClip", () => {
  it("swaps the take in the slot and keeps the clip's treatment, link and sound", () => {
    const result = replaceClip(cut(), "shot", {
      info: info("take2.mp4"),
      rangeIn: 3,
      policy: "keep-speed",
    });

    const shot = byId(result.project, "shot");
    const sound = byId(result.project, "shot-sound");
    const take = result.project?.sources.find((source) => source.name === "take2.mp4");
    expect(shot).toMatchObject({ start: 1, duration: 2, source_id: take?.id, source_in: 3 });
    expect(shot?.adjust).toEqual(graded);
    expect(shot?.transform.scale).toBe(0.5);
    expect(shot?.fade_in).toBe(0.2);
    expect(sound).toMatchObject({ source_id: take?.id, source_in: 3, link_id: "l", gain: 0.7 });
    expect(result.note).toBeUndefined();
  });

  it("shortens the clip for a shorter take and leaves its neighbours where they were", () => {
    const result = replaceClip(cut(), "shot", {
      info: info("short.mp4", { duration: 1.5 }),
      policy: "keep-speed",
    });

    expect(byId(result.project, "shot")?.duration).toBeCloseTo(1.5);
    expect(byId(result.project, "shot-sound")?.duration).toBeCloseTo(1.5);
    expect(byId(result.project, "next")?.start).toBe(3);
    expect(result.note).toMatch(/0\.50 s shorter.*Fit to fill/);
  });

  it("fits the marked range into the slot by retiming it, within the speed range", () => {
    const fitted = replaceClip(cut(), "shot", {
      info: info("long.mp4"),
      rangeIn: 1,
      rangeOut: 5,
      policy: "fit-to-fill",
    });
    expect(byId(fitted.project, "shot")).toMatchObject({ start: 1, duration: 2, speed: 2 });

    const tooFast = replaceClip(cut(), "shot", {
      info: info("long.mp4", { duration: 30 }),
      policy: "fit-to-fill",
    });
    expect(tooFast.error).toMatch(/15\.00×, outside 0\.25× to 4×/);
  });

  it("refuses a shorter take that would lose the clip's dissolve, which fit to fill keeps", () => {
    const base = cut();
    const overlapping = {
      ...base,
      clips: base.clips.map((clip) => (clip.id === "next" ? { ...clip, start: 2.5 } : clip)),
      transitions: [{ id: "x", from_clip_id: "shot", to_clip_id: "next" }],
    };
    const short = info("short.mp4", { duration: 1 });

    expect(replaceClip(overlapping, "shot", { info: short, policy: "keep-speed" }).error).toMatch(
      /too short to keep this clip's dissolve/,
    );
    const fitted = replaceClip(overlapping, "shot", { info: short, policy: "fit-to-fill" });
    expect(fitted.project?.transitions).toHaveLength(1);
  });

  it("drops the linked sound for a silent take and unlinks the picture", () => {
    const result = replaceClip(cut(), "shot", {
      info: info("silent.mp4", { has_audio: false }),
      policy: "keep-speed",
    });

    expect(byId(result.project, "shot-sound")).toBeUndefined();
    expect(byId(result.project, "shot")?.link_id).toBeNull();
  });

  it("adds linked sound when only the new take has it", () => {
    const base = cut();
    const silent = {
      ...base,
      clips: base.clips
        .filter((clip) => clip.id !== "shot-sound")
        .map((clip) => (clip.id === "shot" ? { ...clip, link_id: null } : clip)),
    };

    const result = replaceClip(silent, "shot", { info: info("voiced.mp4"), policy: "keep-speed" });

    const shot = byId(result.project, "shot");
    const sound = result.project?.clips.find((clip) => clip.kind === "audio");
    expect(shot?.link_id).toBeTruthy();
    expect(sound).toMatchObject({ link_id: shot?.link_id, start: 1, duration: 2, track_id: "a1" });
  });

  it("replaces a picture with a still, and refuses titles and locked tracks", () => {
    const still = replaceClip(cut(), "shot", {
      info: info("frame.png", { kind: "image", duration: null, has_audio: false }),
      policy: "keep-speed",
    });
    expect(byId(still.project, "shot")).toMatchObject({ kind: "image", duration: 2, speed: 1 });

    const titled = makeProject({
      clips: [makeClip("t", "v1", 0, 2, { kind: "title", source_id: null })],
    });
    expect(replaceClip(titled, "t", { info: info("x.mp4"), policy: "keep-speed" }).error).toMatch(
      /title/,
    );
    const locked = cut({
      tracks: [
        makeTrack("v2", "video"),
        makeTrack("v1", "video", { locked: true }),
        makeTrack("a1", "audio"),
      ],
    });
    expect(
      replaceClip(locked, "shot", { info: info("x.mp4"), policy: "keep-speed" }).error,
    ).toMatch(/V1 is locked/);
  });
});

describe("insertSource", () => {
  it("cuts what crosses the playhead and moves everything after it later together", () => {
    const result = insertSource(cut(), { info: info("insert.mp4", { duration: 1 }), start: 2 });

    const project = result.project!;
    const placed = project.clips.filter((clip) => result.placed?.includes(clip.id));
    expect(placed.map((clip) => [clip.kind, clip.start, clip.duration])).toEqual([
      ["video", 2, 1],
      ["audio", 2, 1],
    ]);
    // The shot is cut at 2 s; its second half and its sound move to 3 s, the still to 4 s.
    const shots = project.clips.filter((clip) => clip.source_id === "film");
    expect(shots.map((clip) => [clip.kind, clip.start, clip.duration]).sort()).toEqual(
      [
        ["audio", 1, 1],
        ["audio", 3, 1],
        ["video", 1, 1],
        ["video", 3, 1],
      ].sort(),
    );
    expect(byId(project, "next")?.start).toBe(4);
  });

  it("refuses to move a locked track", () => {
    const locked = cut({
      tracks: [
        makeTrack("v2", "video"),
        makeTrack("v1", "video"),
        makeTrack("a1", "audio", { locked: true }),
      ],
    });
    expect(insertSource(locked, { info: info("insert.mp4"), start: 0 }).error).toMatch(
      /A1, which is locked/,
    );
  });
});

describe("frame-exact edits", () => {
  it("nudges by whole frames with linked clips and stops at a neighbour", () => {
    const nudged = nudgeClips(cut(), ["shot"], -3, 30);
    expect(byId(nudged.project, "shot")?.start).toBeCloseTo(0.9);
    expect(byId(nudged.project, "shot-sound")?.start).toBeCloseTo(0.9);

    // The shot already ends where the still begins.
    expect(nudgeClips(cut(), ["shot"], 1, 30).error).toMatch(/cannot move there.*overlap/);
    expect(nudgeClips(cut(), [], 1, 30).error).toMatch(/Select clips/);
  });

  it("trims the chosen clip's edge to the playhead, linked sound included", () => {
    const start = trimToPlayhead(cut(), ["shot"], 1.5, "start");
    expect(byId(start.project, "shot")).toMatchObject({ start: 1.5, duration: 1.5, source_in: 1 });
    expect(byId(start.project, "shot-sound")?.start).toBe(1.5);

    const end = trimToPlayhead(cut(), [], 2.5, "end");
    expect(byId(end.project, "shot")?.duration).toBeCloseTo(1.5);
    expect(trimToPlayhead(cut(), ["next"], 1.5, "end").error).toMatch(/not inside a clip/);
  });

  it("sets an exact start, length and in point, and refuses what the file cannot give", () => {
    expect(byId(setClipStart(cut(), "shot", 0).project, "shot-sound")?.start).toBe(0);
    expect(byId(setClipLength(cut(), "next", 4).project, "next")?.duration).toBe(4);
    const alone = cut();
    alone.clips = alone.clips.filter((clip) => clip.id !== "next");
    expect(setClipLength(alone, "shot", 9).error).toMatch(/runs out after 7\.50 s/);

    const slipped = slipClip(cut(), "shot", 4);
    expect(byId(slipped.project, "shot")).toMatchObject({ start: 1, duration: 2, source_in: 4 });
    expect(byId(slipped.project, "shot-sound")?.source_in).toBe(4);
    expect(slipClip(cut(), "shot", 7).error).toMatch(/between 0 and 6\.00 s/);
    expect(slipClip(cut(), "next", 1).error).toMatch(/Only video and sound/);
  });
});

describe("batch edits", () => {
  it("sets one value on every selected clip it applies to", () => {
    const result = updateClips(cut(), ["shot", "shot-sound", "next"], (clip) =>
      clip.kind === "audio" ? null : { transform: { ...clip.transform, opacity: 0.5 } },
    );

    expect(byId(result.project, "shot")?.transform).toMatchObject({ opacity: 0.5, scale: 0.5 });
    expect(byId(result.project, "next")?.transform.opacity).toBe(0.5);
    expect(byId(result.project, "shot-sound")?.transform.opacity).toBe(1);
    expect(updateClips(cut(), ["shot-sound"], () => null).error).toMatch(/None of the selected/);
  });

  it("sets the length of stills and titles only", () => {
    const result = setClipsLength(cut(), ["shot", "next"], 1);
    expect(byId(result.project, "next")?.duration).toBe(1);
    expect(byId(result.project, "shot")?.duration).toBe(2);
    expect(setClipsLength(cut(), ["shot"], 1).error).toMatch(/stills and titles/);
  });
});
