import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { PreviewEngine, type SourceLocation } from "./previewEngine";
import { restingAdjust, type Project } from "./timeline";

function project(duration: number): Project {
  return {
    format_version: 1,
    id: "p",
    name: "Edit",
    revision: 0,
    created_at: "",
    updated_at: "",
    width: 64,
    height: 48,
    frame_rate: 30,
    initial_source_id: null,
    sources: [],
    tracks: [
      {
        id: "v1",
        kind: "video",
        name: "V1",
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      },
    ],
    clips: [
      {
        id: "c",
        track_id: "v1",
        kind: "image",
        source_id: null,
        start: 0,
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
        title: null,
      },
    ],
    transitions: [],
    export: {
      filename: "",
      size: "source",
      orientation: null,
      quality: "standard",
      copy_caption: false,
    },
  };
}

describe("PreviewEngine", () => {
  const engine = new PreviewEngine();
  afterEach(() => engine.pause());

  it("stops on the last instant, not on a frame past the end", () => {
    // 10.02 s is 300.6 frames at 30 fps; the nearest frame lies past the end.
    engine.setProject(project(10.02), new Map());
    engine.play();
    engine.seek(10.02);

    engine.pause();

    expect(engine.currentTime).toBeLessThanOrEqual(engine.duration);
  });
});

interface Call {
  name: string;
  args: unknown[];
}

/** A canvas whose 2D context records every call, since jsdom draws nothing. */
function recordingCanvas(): { canvas: HTMLCanvasElement; calls: Call[] } {
  const calls: Call[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const state: Record<string | symbol, unknown> = { canvas };
  const context = new Proxy(state, {
    get: (target, key) =>
      key in target
        ? target[key]
        : (...args: unknown[]) => {
            calls.push({ name: String(key), args });
          },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  canvas.getContext = (() => context) as unknown as HTMLCanvasElement["getContext"];
  return { canvas, calls };
}

function located(missing = false): Map<string, SourceLocation> {
  return new Map([
    ["still", { path: "/media/still.png", version: "1", missing }],
    ["film", { path: "/media/film.mp4", version: "1", missing }],
    ["tone", { path: "/media/tone.wav", version: "1", missing }],
  ]);
}

describe("PreviewEngine drawing and media", () => {
  let engine = new PreviewEngine();
  beforeEach(() => {
    engine = new PreviewEngine();
  });
  afterEach(() => {
    engine.dispose();
    engine.attach(null);
    vi.restoreAllMocks();
  });

  it("draws missing media as a marked box instead of leaving it out", () => {
    const { canvas, calls } = recordingCanvas();
    engine.setProject(makeProject(), located(true));
    engine.attach(canvas);

    engine.seek(1);

    expect(calls).toContainEqual({ name: "fillText", args: ["Missing media", 0, 0] });
  });

  it("draws a loaded still through its crop", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(100);
    const { canvas, calls } = recordingCanvas();
    const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
    engine.setProject(makeProject({ clips: [makeClip("first", "v1", 0, 2, { crop })] }), located());
    engine.attach(canvas);

    engine.seek(1);

    const drawn = calls.find((call) => call.name === "drawImage");
    expect(drawn?.args.slice(1, 5)).toEqual([100, 0, 100, 100]);
  });

  it("holds the clock while a shown video has no frames, then runs it", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const videos: HTMLVideoElement[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "video") videos.push(element as HTMLVideoElement);
      return element;
    });
    engine.setProject(
      makeProject({
        sources: [makeSource("film", "film.mp4", "video")],
        clips: [makeClip("shot", "v1", 0, 4, { kind: "video", source_id: "film" })],
      }),
      located(),
    );

    engine.play();
    await vi.waitFor(() => expect(engine.isWaiting).toBe(true));
    expect(engine.currentTime).toBe(0);

    Object.defineProperty(videos[0], "readyState", { configurable: true, value: 4 });
    await vi.waitFor(() => expect(engine.currentTime).toBeGreaterThan(0));
    expect(engine.isWaiting).toBe(false);

    engine.dispose();
    expect(videos[0].getAttribute("src")).toBeNull();
  });

  it("plays sound at its clip's gain", () => {
    const volume = vi.spyOn(HTMLMediaElement.prototype, "volume", "set");
    engine.setProject(
      makeProject({
        sources: [makeSource("tone", "tone.wav", "audio")],
        clips: [makeClip("beep", "a1", 0, 4, { kind: "audio", source_id: "tone", gain: 0.5 })],
      }),
      located(),
    );

    engine.seek(1);

    expect(volume).toHaveBeenCalledWith(0.5);
  });
});
