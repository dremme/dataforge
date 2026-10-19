import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClip, makeProject, makeSource } from "@/test/videoProject";
import { AdjustRenderer } from "@/features/gallery/lib/adjustRenderer";
import {
  MEDIA_STALL_MS,
  peakOf,
  PreviewEngine,
  problemFromError,
  type SourceLocation,
} from "./previewEngine";
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
    background: "#000000",
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
        gain: 1,
        speech: false,
        sync_lock: true,
        collapsed: false,
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
        fade_curve: "equal_power",
        title: null,
        keyframes: { x: [], y: [], scale: [], rotation: [], opacity: [], gain: [] },
      },
    ],
    transitions: [],
    mix: { master_gain: 1, duck_gain: 0.25 },
    markers: [],
    export: {
      filename: "",
      size: "source",
      orientation: null,
      quality: "standard",
      copy_caption: false,
      audio_level: "limit",
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

  it("replays from the start after playing to the end", async () => {
    // 10.01 s is 300.3 frames at 30 fps; the nearest frame lies before the end.
    engine.setProject(project(10.01), new Map());
    engine.play();
    engine.seek(10.01);
    await vi.waitFor(() => expect(engine.isPlaying).toBe(false));

    engine.play();

    expect(engine.currentTime).toBeLessThan(1);
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

describe("PreviewEngine media problems and fidelity", () => {
  let engine = new PreviewEngine();
  const videos: HTMLVideoElement[] = [];
  const film = () =>
    makeProject({
      sources: [makeSource("film", "film.mp4", "video")],
      clips: [makeClip("shot", "v1", 0, 4, { kind: "video", source_id: "film" })],
    });
  beforeEach(() => {
    engine = new PreviewEngine();
    videos.length = 0;
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === "video") videos.push(element as HTMLVideoElement);
      return element;
    });
  });
  afterEach(() => {
    engine.dispose();
    engine.attach(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names a file the browser rejects, draws it as such and stops waiting for it", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { canvas, calls } = recordingCanvas();
    engine.setProject(film(), located());
    engine.attach(canvas);
    engine.play();
    await vi.waitFor(() => expect(engine.isWaiting).toBe(true));

    Object.defineProperty(videos[0], "error", { configurable: true, value: { code: 4 } });
    videos[0].dispatchEvent(new Event("error"));

    expect(engine.mediaProblems).toEqual([{ sourceId: "film", kind: "unsupported" }]);
    await vi.waitFor(() => expect(engine.currentTime).toBeGreaterThan(0));
    engine.pause();
    expect(calls).toContainEqual({ name: "fillText", args: ["Format not supported", 0, 0] });
  });

  it("reports a video with sound but no picture it can decode", () => {
    engine.setProject(film(), located());
    engine.seek(1);
    Object.defineProperty(videos[0], "videoWidth", { configurable: true, value: 0 });

    videos[0].dispatchEvent(new Event("loadedmetadata"));

    expect(engine.mediaProblems).toEqual([{ sourceId: "film", kind: "no-picture" }]);
  });

  it("reports a video that shows no picture for too long", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    engine.setProject(film(), located());
    engine.seek(1);

    vi.advanceTimersByTime(MEDIA_STALL_MS - 1);
    expect(engine.mediaProblems).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(engine.mediaProblems).toEqual([{ sourceId: "film", kind: "stalled" }]);
  });

  it("loads a failed file afresh on retry, and a teardown is not a failure", () => {
    engine.setProject(film(), located());
    engine.seek(1);
    Object.defineProperty(videos[0], "error", { configurable: true, value: { code: 3 } });
    videos[0].dispatchEvent(new Event("error"));
    expect(engine.mediaProblems).toEqual([{ sourceId: "film", kind: "decode" }]);

    engine.retry("film");

    expect(engine.mediaProblems).toEqual([]);
    expect(videos).toHaveLength(2);
    expect(videos[0].getAttribute("src")).toBeNull();
    // The released element's own teardown must not bring the problem back.
    videos[0].dispatchEvent(new Event("error"));
    expect(engine.mediaProblems).toEqual([]);
  });

  it("reports adjusted clips it cannot color and ones drawn from a reduced copy", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1080);
    const graded = makeProject({
      clips: [makeClip("first", "v1", 0, 2, { adjust: { ...restingAdjust(), exposure: 0.3 } })],
    });
    const { canvas } = recordingCanvas();
    engine.attach(canvas);
    vi.spyOn(AdjustRenderer, "create").mockReturnValue(null);
    engine.setProject(graded, located());
    engine.seek(1);
    expect(engine.previewFidelity).toEqual({ adjustUnavailable: true, adjustReduced: false });

    engine.dispose();
    engine = new PreviewEngine();
    const fake = {
      setLut: vi.fn<AdjustRenderer["setLut"]>(),
      setSource: vi.fn<AdjustRenderer["setSource"]>(),
      render: vi.fn<AdjustRenderer["render"]>(),
      dispose: vi.fn<AdjustRenderer["dispose"]>(),
    };
    vi.spyOn(AdjustRenderer, "create").mockReturnValue(fake as unknown as AdjustRenderer);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn<() => void>(),
    } as unknown as CanvasRenderingContext2D);
    engine.attach(recordingCanvas().canvas);
    engine.setProject(graded, located());
    engine.seek(1);
    expect(engine.previewFidelity).toEqual({ adjustUnavailable: false, adjustReduced: true });
  });

  it("names media errors by their code and measures a peak in either polarity", () => {
    expect(problemFromError({ code: 2 })).toBe("network");
    expect(problemFromError({ code: 3 })).toBe("decode");
    expect(problemFromError(null)).toBe("unsupported");
    expect(peakOf(new Float32Array([0.1, -0.8, 0.5]))).toBeCloseTo(0.8);
  });
});
