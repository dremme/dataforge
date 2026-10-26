import { describe, expect, it } from "vitest";
import { makeClip, makeProject, makeSource, makeTrack } from "@/test/videoProject";
import { copyClips, pasteAttributes, pastableGroups, pasteClips } from "./clipboard";
import { restingAdjust, type Clip, type Project } from "./timeline";

const graded = { ...restingAdjust(), saturation: -0.3 };

function edit(): Project {
  return makeProject({
    sources: [makeSource("film", "film.mp4", "video"), makeSource("still", "still.png", "image")],
    clips: [
      makeClip("a", "v1", 0, 2, {
        kind: "video",
        source_id: "film",
        link_id: "l1",
        adjust: graded,
      }),
      makeClip("a-sound", "a1", 0, 2, { kind: "audio", source_id: "film", link_id: "l1" }),
      makeClip("b", "v1", 1.5, 2, { kind: "video", source_id: "film", link_id: "l2" }),
      makeClip("b-sound", "a1", 1.5, 2, { kind: "audio", source_id: "film", link_id: "l2" }),
    ],
    transitions: [{ id: "x", from_clip_id: "a", to_clip_id: "b" }],
  });
}

describe("copy and paste", () => {
  it("pastes copies at the playhead with their links and dissolve, reusing the sources", () => {
    const project = edit();
    const content = copyClips(project, ["a", "b"], "/media")!;
    expect(content.clips).toHaveLength(4);

    const result = pasteClips(project, content, 10);

    const pasted = result.project!.clips.filter((clip) => result.placed!.includes(clip.id));
    expect(pasted.map((clip) => clip.start).sort()).toEqual([10, 10, 11.5, 11.5]);
    expect(pasted.every((clip) => !["a", "b", "a-sound", "b-sound"].includes(clip.id))).toBe(true);
    const links = new Set(pasted.map((clip) => clip.link_id));
    expect(links.size).toBe(2);
    expect([...links].some((link) => link === "l1" || link === "l2")).toBe(false);
    expect(result.project!.transitions).toHaveLength(2);
    expect(result.project!.sources).toHaveLength(2);
    expect(result.added).toEqual([]);
  });

  it("adds the sources another project lacks and maps tracks by position", () => {
    const content = copyClips(edit(), ["a"], "/media")!;
    const other = makeProject({
      sources: [],
      clips: [],
      tracks: [
        makeTrack("top", "video"),
        makeTrack("bottom", "video"),
        makeTrack("sound", "audio"),
      ],
    });

    const result = pasteClips(other, content, 0);

    expect(result.added?.map((source) => source.name)).toEqual(["film.mp4"]);
    expect(result.project!.clips.map((clip) => clip.track_id).sort()).toEqual(["bottom", "sound"]);
  });

  it("explains a paste over clips that are there", () => {
    const project = edit();
    const result = pasteClips(project, copyClips(project, ["a"], "/media")!, 0.5);
    expect(result.error).toMatch(/no free space.*overlap/);
  });
});

describe("paste attributes", () => {
  it("applies only the chosen settings, and only to clips that can take them", () => {
    const project = makeProject({
      sources: [makeSource("film", "film.mp4", "video"), makeSource("still", "still.png", "image")],
      clips: [
        makeClip("donor", "v1", 0, 1, {
          kind: "video",
          source_id: "film",
          adjust: graded,
          fade_in: 0.2,
          transform: { x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 0.8 },
        }),
        makeClip("still", "v1", 2, 1),
        makeClip("sound", "a1", 0, 1, { kind: "audio", source_id: "film" }),
      ],
    });
    const donor = project.clips[0];
    expect(pastableGroups(donor, project.clips.slice(1))).toEqual([
      "color",
      "transform",
      "crop",
      "fades",
    ]);

    const result = pasteAttributes(project, ["still", "sound"], donor, ["color", "fades"]);

    const still = result.project!.clips.find((clip) => clip.id === "still")!;
    const sound = result.project!.clips.find((clip) => clip.id === "sound")!;
    expect(still.adjust).toEqual(graded);
    expect(still.fade_in).toBe(0.2);
    expect(still.transform.scale).toBe(1);
    expect(sound.adjust).toEqual(restingAdjust());
    expect(sound.fade_in).toBe(0.2);
  });

  it("pastes sound with its EQ keyframes and keeps the target's gain envelope", () => {
    const key = (time: number, value: number) => ({ time, value, easing: "linear" as const });
    const sound = (id: string, keyframes: Partial<Clip["keyframes"]>) => {
      const clip = makeClip(id, "a1", 0, 1, { kind: "audio", source_id: "film" });
      return { ...clip, keyframes: { ...clip.keyframes, ...keyframes } };
    };
    const donor = sound("donor", { treble: [key(0, -6), key(1, 6)] });
    const target = sound("target", { gain: [key(0, 0), key(1, 1)], bass: [key(0, 3)] });
    const project = makeProject({
      sources: [makeSource("film", "film.mp4", "video")],
      clips: [donor, { ...target, start: 2 }],
    });

    const pasted = pasteAttributes(project, ["target"], donor, ["sound"]).project!.clips[1];

    expect(pasted.keyframes.treble).toEqual(donor.keyframes.treble);
    expect(pasted.keyframes.bass).toEqual([]);
    expect(pasted.keyframes.gain).toEqual(target.keyframes.gain);
  });
});
