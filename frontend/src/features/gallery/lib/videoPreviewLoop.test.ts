import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoPreviewLoop } from "./videoPreviewLoop";

function decoder() {
  const video = document.createElement("video");
  let time = 0;
  let seeking = false;
  let paused = true;
  let nextFrame = 1;
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  const seeks: number[] = [];
  Object.defineProperties(video, {
    currentTime: {
      get: () => time,
      set: (next: number) => {
        time = next;
        seeking = true;
        seeks.push(next);
        video.dispatchEvent(new Event("seeking"));
      },
    },
    seeking: { get: () => seeking },
    paused: { get: () => paused },
    readyState: { configurable: true, value: video.HAVE_ENOUGH_DATA },
  });
  video.play = vi.fn(() => {
    paused = false;
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  });
  video.pause = vi.fn(() => {
    paused = true;
    video.dispatchEvent(new Event("pause"));
  });
  video.requestVideoFrameCallback = vi.fn((callback) => {
    const id = nextFrame++;
    callbacks.set(id, callback);
    return id;
  });
  video.cancelVideoFrameCallback = vi.fn((id) => callbacks.delete(id));
  return {
    video,
    seeks,
    callbacks,
    advance(next: number) {
      time = next;
    },
    settle() {
      seeking = false;
      video.dispatchEvent(new Event("seeked"));
    },
    present() {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback(0, { mediaTime: time } as VideoFrameCallbackMetadata);
    },
  };
}

function preview() {
  const primary = decoder();
  const standby = decoder();
  let range = { start: 2, end: 8 };
  const onSwitch = vi.fn();
  const onPlayError = vi.fn();
  const loop = new VideoPreviewLoop({
    videos: [primary.video, standby.video],
    getRange: () => range,
    getFrameDuration: () => 1 / 25,
    onSwitch,
    onPlayError,
  });
  return {
    loop,
    primary,
    standby,
    onSwitch,
    onPlayError,
    range(next: typeof range) {
      range = next;
    },
    prepare() {
      loop.prepare();
      standby.settle();
      standby.present();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("VideoPreviewLoop", () => {
  it("waits for the seek and decoded frame, then switches without seeking the visible player", () => {
    const { loop, primary, standby, onSwitch } = preview();
    loop.prepare();
    expect(standby.video.currentTime).toBe(2);
    expect(standby.video.paused).toBe(true);
    expect(standby.video.muted).toBe(true);
    standby.settle();
    standby.present();
    primary.advance(8);
    loop.lap();
    expect(onSwitch).not.toHaveBeenCalled();
    expect(primary.seeks).toEqual([]);
    expect(loop.handingOff).toBe(true);
    standby.present();
    expect(loop.current).toBe(standby.video);
    expect(onSwitch).toHaveBeenCalledWith(1);
    expect(primary.video.style.opacity).toBe("0");
    expect(standby.video.style.opacity).toBe("1");
    expect(primary.seeks).toEqual([2]);
    expect(primary.video.paused).toBe(true);
    loop.dispose();
  });

  it("alternates repeatedly and copies playback speed and audio settings", () => {
    const view = preview();
    view.primary.video.playbackRate = 1.5;
    view.primary.video.volume = 0.5;
    view.primary.video.muted = false;
    view.prepare();
    for (let lap = 0; lap < 4; lap += 1) {
      const outgoing = lap % 2 === 0 ? view.primary : view.standby;
      const incoming = lap % 2 === 0 ? view.standby : view.primary;
      outgoing.advance(8);
      view.loop.lap();
      expect(incoming.video.muted).toBe(true);
      incoming.present();
      expect(incoming.video.muted).toBe(false);
      expect(outgoing.video.muted).toBe(true);
      expect(incoming.video.playbackRate).toBe(1.5);
      expect(incoming.video.volume).toBe(0.5);
      outgoing.settle();
      outgoing.present();
    }
    expect(view.onSwitch.mock.calls.map(([index]) => index)).toEqual([1, 0, 1, 0]);
    view.loop.dispose();
  });

  it("falls back once while standby decoding is unfinished, without restarting a pending seek", () => {
    const { loop, primary, standby, onSwitch } = preview();
    loop.prepare();
    standby.settle();
    primary.advance(8);
    loop.lap();
    loop.lap();
    expect(primary.seeks).toEqual([2]);
    expect(onSwitch).not.toHaveBeenCalled();
    loop.dispose();
  });

  it("can use decoded readiness when a paused browser does not deliver a frame callback", () => {
    vi.useFakeTimers();
    const { loop, primary, standby, onSwitch } = preview();
    loop.prepare();
    standby.settle();
    vi.advanceTimersByTime(150);
    primary.advance(8);
    loop.lap();
    standby.present();
    expect(onSwitch).toHaveBeenCalledWith(1);
    loop.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates prepared frames after trim changes and ignores stale callbacks", () => {
    const view = preview();
    view.loop.prepare();
    const stale = [...view.standby.callbacks.values()][0];
    view.range({ start: 3, end: 6 });
    view.loop.prepare();
    stale(0, { mediaTime: 2 } as VideoFrameCallbackMetadata);
    view.primary.advance(6);
    view.loop.lap();
    expect(view.primary.seeks).toEqual([3]);
    expect(view.onSwitch).not.toHaveBeenCalled();
    view.primary.settle();
    view.standby.settle();
    view.standby.present();
    view.primary.advance(6);
    view.loop.lap();
    view.standby.present();
    expect(view.onSwitch).toHaveBeenCalledWith(1);
    view.loop.dispose();
  });

  it("rejects a prepared frame if the range changes before preparation is restarted", () => {
    const view = preview();
    view.prepare();
    view.range({ start: 3, end: 6 });
    view.primary.advance(6);
    view.loop.lap();
    expect(view.primary.video.currentTime).toBe(3);
    expect(view.standby.video.play).not.toHaveBeenCalled();
    view.loop.dispose();
  });

  it("cancels an in-flight handoff when playback is paused or manually sought", async () => {
    const view = preview();
    view.prepare();
    view.primary.advance(8);
    view.loop.lap();
    const stale = [...view.standby.callbacks.values()][0];
    view.loop.invalidate();
    view.primary.video.pause();
    stale(0, { mediaTime: 2 } as VideoFrameCallbackMetadata);
    await Promise.resolve();
    expect(view.onSwitch).not.toHaveBeenCalled();
    expect(view.loop.current).toBe(view.primary.video);
    expect(view.standby.video.paused).toBe(true);
    view.loop.dispose();
  });

  it("recovers from a rejected standby play without retrying that handoff", async () => {
    const view = preview();
    view.prepare();
    vi.mocked(view.standby.video.play).mockRejectedValue(new Error("Playback unavailable"));
    view.primary.advance(8);
    view.loop.lap();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.primary.seeks).toEqual([2]);
    expect(view.loop.handingOff).toBe(false);
    view.loop.lap();
    expect(view.standby.video.play).toHaveBeenCalledTimes(1);
    view.loop.dispose();
  });

  it("reports a rejected active play and cancels both decoders on disposal", async () => {
    vi.useFakeTimers();
    const view = preview();
    vi.mocked(view.primary.video.play).mockRejectedValue(new Error("Playback unavailable"));
    view.loop.play();
    await Promise.resolve();
    expect(view.onPlayError).toHaveBeenCalledOnce();
    view.loop.prepare();
    const stale = [...view.standby.callbacks.values()][0];
    view.loop.dispose();
    stale(0, { mediaTime: 2 } as VideoFrameCallbackMetadata);
    expect(vi.getTimerCount()).toBe(0);
    expect(view.primary.video.paused).toBe(true);
    expect(view.standby.video.paused).toBe(true);
    expect(view.onSwitch).not.toHaveBeenCalled();
  });

  it("does not re-seek a standby that is ready or readying for the same range", () => {
    const { loop, standby } = preview();
    loop.prepare();
    loop.prepare();
    standby.settle();
    standby.present();
    loop.prepare();
    expect(standby.seeks).toEqual([2]);
    loop.dispose();
  });

  it("re-arms the standby on a fallback lap after a timed-out preparation", () => {
    vi.useFakeTimers();
    const view = preview();
    view.loop.prepare();
    vi.advanceTimersByTime(2500);
    view.primary.advance(8);
    view.loop.lap();
    expect(view.primary.seeks).toEqual([2]);
    expect(view.standby.seeks).toEqual([2, 2]);
    view.primary.settle();
    view.standby.settle();
    view.standby.present();
    view.primary.advance(8);
    view.loop.lap();
    view.standby.present();
    expect(view.onSwitch).toHaveBeenCalledWith(1);
    view.loop.dispose();
  });

  it("times preparation from the seek, so a slow first load still readies the standby", () => {
    vi.useFakeTimers();
    const view = preview();
    Object.defineProperty(view.standby.video, "readyState", { configurable: true, value: 0 });
    view.loop.prepare();
    vi.advanceTimersByTime(4000);
    Object.defineProperty(view.standby.video, "readyState", { configurable: true, value: 4 });
    view.standby.video.dispatchEvent(new Event("loadedmetadata"));
    view.standby.settle();
    view.standby.present();
    view.primary.advance(8);
    view.loop.lap();
    expect(view.primary.seeks).toEqual([]);
    view.standby.present();
    expect(view.onSwitch).toHaveBeenCalledWith(1);
    view.loop.dispose();
  });

  it("stops re-arming after repeated failed handoffs", async () => {
    const view = preview();
    vi.mocked(view.standby.video.play).mockRejectedValue(new Error("Playback unavailable"));
    view.prepare();
    for (let lap = 0; lap < 8; lap += 1) {
      view.primary.settle();
      view.standby.settle();
      view.standby.present();
      view.primary.advance(8);
      view.loop.lap();
      await new Promise((resolve) => setTimeout(resolve));
    }
    expect(view.standby.video.play).toHaveBeenCalledTimes(3);
    expect(view.onSwitch).not.toHaveBeenCalled();
    view.loop.dispose();
  });

  it("times out an unavailable decoder and keeps the precise single-player fallback", () => {
    vi.useFakeTimers();
    const view = preview();
    view.loop.prepare();
    vi.advanceTimersByTime(2500);
    view.primary.advance(8);
    view.loop.lap();
    expect(view.primary.video.currentTime).toBe(2);
    expect(view.onSwitch).not.toHaveBeenCalled();
    view.loop.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a presentation already queued when standby preparation times out", () => {
    vi.useFakeTimers();
    const view = preview();
    view.loop.prepare();
    view.standby.settle();
    Object.defineProperty(view.standby.video, "readyState", { configurable: true, value: 2 });
    const stale = [...view.standby.callbacks.values()][0];
    vi.advanceTimersByTime(2500);
    Object.defineProperty(view.standby.video, "readyState", { configurable: true, value: 4 });
    stale(0, { mediaTime: 2 } as VideoFrameCallbackMetadata);
    view.primary.advance(8);
    view.loop.lap();
    expect(view.primary.video.currentTime).toBe(2);
    expect(view.standby.video.play).not.toHaveBeenCalled();
    view.loop.dispose();
  });
});
