import { describe, expect, it } from "vitest";
import {
  audibleTrackIds,
  estimateExportBytes,
  exportSize,
  fadeLevel,
  layersAt,
  pictureTime,
  placement,
  transitionFades,
  voicesAt,
} from "./composition";
import { restingAdjust, type Clip, type Project } from "./timeline";

const settings = {
  filename: "",
  size: "source",
  orientation: null,
  quality: "standard",
  copy_caption: false,
  audio_level: "limit",
} as const;

function clip(
  id: string,
  track: string,
  start: number,
  duration: number,
  extra: Partial<Clip> = {},
): Clip {
  return {
    id,
    track_id: track,
    kind: track.startsWith("a") ? "audio" : "image",
    source_id: "src",
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
    ...extra,
  };
}

function project(clips: Clip[], tracks: Partial<Project["tracks"][number]>[] = []): Project {
  const base = [
    { id: "v2", kind: "video" as const, name: "V2" },
    { id: "v1", kind: "video" as const, name: "V1" },
    { id: "a1", kind: "audio" as const, name: "A1" },
    { id: "a2", kind: "audio" as const, name: "A2" },
  ];
  return {
    format_version: 1,
    id: "p",
    name: "E",
    revision: 0,
    created_at: "",
    updated_at: "",
    width: 1920,
    height: 1080,
    frame_rate: 30,
    sources: [
      {
        id: "src",
        name: "a.png",
        kind: "image",
        size: 1,
        modified_us: 1,
        width: 1000,
        height: 1000,
        has_audio: false,
      },
    ],
    tracks: base.map((track) => ({
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      gain: 1,
      speech: false,
      ...track,
      ...tracks.find((patch) => patch.id === track.id),
    })),
    clips,
    transitions: [],
    mix: { master_gain: 1, duck_gain: 0.25 },
    export: settings,
  };
}

describe("exportSize", () => {
  it("matches the backend's presets", () => {
    const frame = { width: 1280, height: 720 };
    expect(exportSize(frame, settings)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(frame, { ...settings, orientation: "portrait" })).toEqual({
      width: 720,
      height: 1280,
    });
    expect(exportSize({ width: 640, height: 480 }, { ...settings, size: "1080p" })).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});

describe("estimateExportBytes", () => {
  it("grows with length and quality, and counts sound only when there is some", () => {
    const picture = project([clip("v", "v1", 0, 10)]);
    const standard = estimateExportBytes(picture, settings);

    expect(estimateExportBytes(project([clip("v", "v1", 0, 20)]), settings)).toBeCloseTo(
      2 * standard,
    );
    expect(estimateExportBytes(picture, { ...settings, quality: "high" })).toBeGreaterThan(
      standard,
    );
    expect(estimateExportBytes(picture, { ...settings, quality: "small" })).toBeLessThan(standard);
    expect(estimateExportBytes(picture, { ...settings, size: "720p" })).toBeLessThan(standard);
    const voiced = project([clip("v", "v1", 0, 10), clip("s", "a1", 0, 10)]);
    expect(estimateExportBytes(voiced, settings) - standard).toBeCloseTo((192_000 * 10) / 8);
  });
});

describe("pictureTime", () => {
  it("shows the last frame when the playhead rests on the end", () => {
    const edit = project([clip("v", "v1", 0, 2)]);

    expect(layersAt(edit, pictureTime(edit, 2)).map((layer) => layer.clip.id)).toEqual(["v"]);
    expect(pictureTime(edit, 1)).toBe(1);
  });
});

describe("layersAt", () => {
  it("stacks the lowest track first and leaves hidden tracks out", () => {
    const clips = [clip("top", "v2", 0, 2), clip("bottom", "v1", 0, 2)];

    expect(layersAt(project(clips), 1).map((layer) => layer.clip.id)).toEqual(["bottom", "top"]);
    expect(layersAt(project(clips, [{ id: "v2", hidden: true }]), 1)).toHaveLength(1);
  });

  it("fades a dissolve's incoming clip in over the overlap", () => {
    const first = clip("first", "v1", 0, 3);
    const second = clip("second", "v1", 2, 3);
    const joined = {
      ...project([first, second]),
      transitions: [{ id: "d", from_clip_id: "first", to_clip_id: "second" }],
    };

    const layers = layersAt(joined, 2.5);

    expect(layers.map((layer) => [layer.clip.id, layer.alpha])).toEqual([
      ["first", 1],
      ["second", 0.5],
    ]);
  });
});

describe("audio", () => {
  it("lets solo silence the rest while mute beats solo", () => {
    const tracks = [{ id: "a1", solo: true }, { id: "a2" }];

    expect([...audibleTrackIds(project([], tracks))]).toEqual(["a1"]);
    expect([...audibleTrackIds(project([], [{ id: "a1", solo: true, muted: true }]))]).toEqual([]);
  });

  it("applies gain and fades", () => {
    const voice = clip("music", "a1", 0, 4, { gain: 0.5, fade_out: 2, fade_curve: "linear" });
    const p = project([voice]);

    expect(voicesAt(p, 3)[0].gain).toBeCloseTo(0.25);
    expect(fadeLevel(voice, 1, transitionFades(p))).toBe(1);
    const curved = { ...voice, fade_curve: "equal_power" as const };
    expect(fadeLevel(curved, 3, transitionFades(project([curved])))).toBeCloseTo(Math.SQRT1_2);
  });

  it("cross-fades overlapping sound on one track at equal power", () => {
    const p = project([clip("one", "a1", 0, 2), clip("two", "a1", 1, 2)]);
    const levels = voicesAt(p, 1.5).map((voice) => voice.gain);

    expect(levels).toHaveLength(2);
    expect(levels[0] ** 2 + levels[1] ** 2).toBeCloseTo(1);
  });

  it("follows the gain envelope, then the track, ducking and master levels", () => {
    const music = clip("music", "a2", 0, 4, {
      keyframes: {
        x: [],
        y: [],
        scale: [],
        rotation: [],
        opacity: [],
        gain: [
          { time: 0, value: 0, easing: "linear" },
          { time: 1, value: 1, easing: "linear" },
        ],
      },
    });
    const speech = clip("speech", "a1", 2, 1);
    const p = {
      ...project(
        [music, speech],
        [
          { id: "a1", speech: true },
          { id: "a2", gain: 0.5 },
        ],
      ),
      mix: { master_gain: 2, duck_gain: 0.25 },
    };
    const gainOf = (time: number) =>
      voicesAt(p, time).find((voice) => voice.clip.id === "music")?.gain;

    expect(gainOf(0.5)).toBeCloseTo(0.5);
    expect(gainOf(1.5)).toBeCloseTo(1);
    expect(gainOf(2.5)).toBeCloseTo(0.25);
    expect(voicesAt(p, 2.5).find((voice) => voice.clip.id === "speech")?.gain).toBeCloseTo(2);
  });
});

describe("placement", () => {
  it("draws a keyframed clip where its keyframes put it at that time", () => {
    const keyed = clip("c", "v1", 1, 2, {
      keyframes: {
        x: [
          { time: 0, value: 0, easing: "ease_in" },
          { time: 1, value: 0.5, easing: "linear" },
        ],
        y: [],
        scale: [],
        rotation: [],
        opacity: [],
        gain: [],
      },
    });
    expect(placement(project([]), keyed, 1.5).centerX).toBeCloseTo(960 + 1920 * 0.125);
    expect(placement(project([]), keyed, 5).centerX).toBeCloseTo(960 + 960);
  });

  it("places a title like a canvas-sized picture", () => {
    const title = clip("t", "v1", 0, 1, {
      kind: "title",
      source_id: null,
      transform: { x: 0.25, y: 0, scale: 0.5, rotation: 10, opacity: 1 },
    });
    expect(placement(project([]), title, 0)).toEqual({
      centerX: 1440,
      centerY: 540,
      width: 960,
      height: 540,
      rotation: 10,
    });
  });

  it("fits inside the canvas or fills it, then scales and offsets", () => {
    const fitted = placement(project([]), clip("c", "v1", 0, 1), 0);
    const filled = placement(project([]), clip("c", "v1", 0, 1, { fit: "fill" }), 0);
    const moved = placement(
      project([]),
      clip("c", "v1", 0, 1, { transform: { x: 0.25, y: 0, scale: 0.5, rotation: 0, opacity: 1 } }),
      0,
    );

    expect([fitted.width, fitted.height]).toEqual([1080, 1080]);
    expect([filled.width, filled.height]).toEqual([1920, 1920]);
    expect([moved.centerX, moved.width]).toEqual([960 + 480, 540]);
  });
});
