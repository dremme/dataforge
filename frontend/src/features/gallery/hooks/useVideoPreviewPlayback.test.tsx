import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useVideoPreviewPlayback,
  type UseVideoPreviewPlaybackOptions,
} from "./useVideoPreviewPlayback";

const FRAME = 1 / 25;
const RANGE = { start: 2, end: 8 };
const DURATION = 12;

/** jsdom implements neither play nor pause, and the loop is driven off both. */
function fakeVideo() {
  const listeners = new Map<string, Set<() => void>>();
  const emit = (type: string) => {
    for (const handler of listeners.get(type) ?? []) handler();
  };

  const video = {
    currentTime: 0,
    paused: true,
    duration: DURATION,
    play() {
      video.paused = false;
      emit("play");
      return Promise.resolve();
    },
    pause() {
      video.paused = true;
      emit("pause");
    },
    addEventListener(type: string, handler: () => void) {
      const existing = listeners.get(type) ?? new Set<() => void>();
      existing.add(handler);
      listeners.set(type, existing);
    },
    removeEventListener(type: string, handler: () => void) {
      listeners.get(type)?.delete(handler);
    },
  };

  // Left as the literal: the tests set `paused`, which HTMLVideoElement declares read-only.
  return { video, fire: emit };
}

function stubFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let nextId = 1;

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id);
  });

  return {
    tick(count = 1) {
      for (let index = 0; index < count; index += 1) {
        const due = [...pending.values()];
        pending.clear();
        act(() => {
          for (const callback of due) callback(0);
        });
      }
    },
    running: () => pending.size > 0,
  };
}

type Overrides = Partial<UseVideoPreviewPlaybackOptions>;

function renderPlayback(initial: Overrides = {}) {
  const frames = stubFrames();
  const { video, fire } = fakeVideo();
  // Stable, as the real caller's useRef is: a fresh object would re-subscribe every render.
  const videoRef = { current: video as unknown as HTMLVideoElement };

  const view = renderHook(
    (overrides: Overrides) =>
      useVideoPreviewPlayback({
        videoRef,
        active: true,
        itemPath: "clip.mp4",
        duration: DURATION,
        frameDuration: FRAME,
        getRange: () => RANGE,
        ...overrides,
      }),
    { initialProps: initial },
  );

  return { ...view, video, fire, frames };
}

describe("useVideoPreviewPlayback", () => {
  it("laps back to the in point within a frame of the out point", () => {
    const { result, video, frames } = renderPlayback();

    act(() => void result.current.togglePlay());
    video.currentTime = 8.01;
    frames.tick();

    expect(video.currentTime).toBe(RANGE.start);
    expect(result.current.playing).toBe(true);
  });

  it("laps on timeupdate as well, for a tab whose frames are throttled", () => {
    const { result, video, fire } = renderPlayback();

    act(() => void result.current.togglePlay());
    video.currentTime = 9.5;
    act(() => fire("timeupdate"));

    expect(video.currentTime).toBe(RANGE.start);
  });

  // The element stops itself there, so no frame of ours would ever come.
  it("laps when the file ends before the out point is reached", () => {
    const { result, video, fire } = renderPlayback();

    act(() => void result.current.togglePlay());
    video.currentTime = DURATION;
    video.paused = true;
    act(() => fire("ended"));

    expect(video.currentTime).toBe(RANGE.start);
    expect(video.paused).toBe(false);
  });

  it.each([
    ["before the in point", 0.5],
    ["past the out point", 9],
  ])("starts at the in point when play is pressed with the playhead %s", (_label, parked) => {
    const { result, video } = renderPlayback();
    video.currentTime = parked;

    act(() => void result.current.togglePlay());

    expect(video.currentTime).toBe(RANGE.start);
  });

  // What lets a trim handle park the playhead on the frame it keeps.
  it("leaves a paused playhead alone at the out point", () => {
    const { video, fire, frames } = renderPlayback();
    video.currentTime = RANGE.end;

    act(() => fire("timeupdate"));

    expect(video.currentTime).toBe(RANGE.end);
    expect(frames.running()).toBe(false);
  });

  it("keeps a seek that settles a frame short of the in point", () => {
    const { result, video, frames } = renderPlayback();

    act(() => void result.current.togglePlay());
    video.currentTime = RANGE.start - FRAME / 2;
    frames.tick();

    expect(video.currentTime).toBe(RANGE.start - FRAME / 2);
  });

  it("moves the marker without re-rendering", () => {
    const { result, video, frames } = renderPlayback();
    const marker = document.createElement("div");
    result.current.playheadRef.current = marker;

    act(() => void result.current.togglePlay());
    video.currentTime = 6;
    frames.tick();

    expect(marker.style.left).toBe("50%");
    // State would carry the whole modal into a render on every frame.
    expect(result.current.playheadTime).toBe(0);
  });

  it("hands the marker back to React on pause", () => {
    const { result, video, frames } = renderPlayback();
    const marker = document.createElement("div");
    result.current.playheadRef.current = marker;

    act(() => void result.current.togglePlay());
    video.currentTime = 6;
    frames.tick();
    act(() => video.pause());

    expect(result.current.playheadTime).toBe(6);
    expect(result.current.playing).toBe(false);
    expect(marker.style.left).toBe("");
    expect(frames.running()).toBe(false);
  });

  it("stops ticking once the timeline is off screen", () => {
    const { result, frames, rerender } = renderPlayback();

    act(() => void result.current.togglePlay());
    expect(frames.running()).toBe(true);

    rerender({ active: false });

    expect(frames.running()).toBe(false);
  });
});
