import { describe, expect, it } from "vitest";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { moveClipsFlush, setClipSpeed, splitClips, trimClip } from "./timeline";
import { clipValueAt } from "./keyframes";
import {
  duckLevel,
  ease,
  keyframeValue,
  setValueAt,
  shiftKeyframes,
  toggleKeyframe,
  transformPatchAt,
} from "./keyframes";
import { VIDEO_PROJECT_DUCK_RAMP_SECONDS } from "@/shared/constants";

const key = (
  time: number,
  value: number,
  easing: "linear" | "ease_in_out" | "hold" = "linear",
) => ({
  time,
  value,
  easing,
});

// The same numbers are checked in backend/test_video_project_animation.py.
describe("keyframeValue", () => {
  it("holds outside the keys and eases between them", () => {
    const keys = [key(1, 0.2, "ease_in_out"), key(3, 0.6, "hold"), key(4, 1)];
    expect(keyframeValue(keys, 0, 9)).toBe(0.2);
    expect(keyframeValue(keys, 1.5, 9)).toBeCloseTo(0.2 + 0.4 * 0.15625);
    expect(keyframeValue(keys, 2, 9)).toBeCloseTo(0.4);
    expect(keyframeValue(keys, 3.9, 9)).toBe(0.6);
    expect(keyframeValue(keys, 5, 9)).toBe(1);
    expect(keyframeValue([], 5, 9)).toBe(9);
    expect(ease("ease_in", 0.5)).toBeCloseTo(0.25);
    expect(ease("ease_out", 0.5)).toBeCloseTo(0.75);
  });
});

describe("duckLevel", () => {
  it("ramps before and after speech and bridges short pauses", () => {
    const ramp = VIDEO_PROJECT_DUCK_RAMP_SECONDS;
    const spans: [number, number][] = [
      [2, 3],
      [3.2, 4],
    ];
    expect(duckLevel(spans, 0.25, 1)).toBe(1);
    expect(duckLevel(spans, 0.25, 2 - ramp / 2)).toBeCloseTo(0.625);
    expect(duckLevel(spans, 0.25, 2.5)).toBe(0.25);
    expect(duckLevel(spans, 0.25, 3.1)).toBe(0.25);
    expect(duckLevel(spans, 0.25, 4 + ramp / 2)).toBeCloseTo(0.625);
  });
});

describe("editing keyframes", () => {
  it("changes the static value until a property is keyed, then keys the playhead", () => {
    const clip = makeClip("c", "v1", 2, 4);
    expect(setValueAt(clip, "scale", 3, 1.5)).toEqual({
      transform: { ...clip.transform, scale: 1.5 },
    });

    const keyed = toggleKeyframe(clip, "scale", 3);
    expect(keyed.keyframes.scale).toEqual([key(1, 1)]);
    const changed = { ...keyed, ...setValueAt(keyed, "scale", 5, 2) };
    expect(changed.keyframes.scale).toEqual([key(1, 1), key(3, 2)]);
    const again = { ...changed, ...setValueAt(changed, "scale", 5, 2.5) };
    expect(again.keyframes.scale).toEqual([key(1, 1), key(3, 2.5)]);
  });

  it("leaves the value shown when the last keyframe goes", () => {
    const clip = makeClip("c", "v1", 0, 4);
    const keyed = { ...clip, keyframes: { ...clip.keyframes, opacity: [key(1, 0.4)] } };
    const plain = toggleKeyframe(keyed, "opacity", 1);
    expect(plain.keyframes.opacity).toEqual([]);
    expect(plain.transform.opacity).toBe(0.4);
  });

  it("keys only what a monitor drag changed", () => {
    const clip = makeClip("c", "v1", 0, 4);
    const keyed = { ...clip, keyframes: { ...clip.keyframes, x: [key(0, 0), key(2, 0.5)] } };
    const patch = transformPatchAt(keyed, 1, { ...keyed.transform, x: 0.1, y: 0.2 });
    expect(patch.keyframes?.x).toEqual([key(0, 0), key(1, 0.1), key(2, 0.5)]);
    expect(patch.keyframes?.y).toEqual([]);
    expect(patch.transform?.y).toBe(0.2);
  });

  it("keeps keyframes on their moment when the clip's start moves under them", () => {
    const clip = makeClip("c", "v1", 0, 4);
    const keyed = { ...clip, keyframes: { ...clip.keyframes, x: [key(1, 0), key(3, 1)] } };
    expect(shiftKeyframes(keyed, 2).keyframes.x).toEqual([key(-1, 0), key(1, 1)]);
  });
});

describe("edits keep the motion", () => {
  const moving = makeClip("first", "v1", 0, 4, {
    keyframes: {
      x: [key(0, 0), key(4, 1)],
      y: [],
      scale: [],
      rotation: [],
      opacity: [],
      gain: [],
    },
  });
  const project = makeProject({ clips: [moving] });

  it("is continuous across a split and after a trim", () => {
    const split = splitClips(project, 1.5).project;
    const right = split?.clips.find((clip) => clip.start === 1.5);
    expect(right && clipValueAt(right, "x", 3)).toBeCloseTo(0.75);
    const trimmed = trimClip(project, "first", "start", 1).project?.clips[0];
    expect(trimmed && clipValueAt(trimmed, "x", 2)).toBeCloseTo(0.5);
  });

  it("follows the take when its speed changes", () => {
    const video = {
      ...moving,
      kind: "video" as const,
      source_id: "shot",
      keyframes: { ...moving.keyframes, x: [key(2, 1)] },
    };
    const slowed = setClipSpeed(
      makeProject({
        sources: [makeSource("shot", "shot.mp4", "video", { duration: 10 })],
        clips: [video],
      }),
      "first",
      0.5,
    ).project?.clips[0];
    expect(slowed?.keyframes.x).toEqual([key(4, 1)]);
  });
});

describe("sound crossfades", () => {
  const sound = (id: string, start: number) =>
    makeClip(id, "a1", start, 2, { kind: "audio", source_id: "tone" });
  const project = makeProject({
    sources: [makeSource("tone", "tone.wav", "audio", { duration: 10 })],
    clips: [sound("one", 0), sound("two", 3)],
  });

  it("lets a clip overlap its neighbour on one track", () => {
    const moved = moveClipsFlush(project, { ids: ["two"], delta: -1.5, draggedId: "two" });
    expect(moved.project?.clips.find((clip) => clip.id === "two")?.start).toBeCloseTo(1.5);
  });

  it("never lets one cover another whole", () => {
    const moved = moveClipsFlush(project, { ids: ["two"], delta: -3, draggedId: "two" });
    expect(moved.project?.clips.find((clip) => clip.id === "two")?.start).toBeCloseTo(2);
  });
});
