import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useVideoFrameLoop } from "./useVideoFrameLoop";

function frames() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  return {
    tick() {
      const callbacks = [...pending.values()];
      pending.clear();
      act(() => callbacks.forEach((callback) => callback(0)));
    },
    pending,
  };
}

describe("useVideoFrameLoop", () => {
  it("keeps the fallback running after seeking during playback", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "paused", { value: false, writable: true });
    const loop = frames();
    const paint = vi.fn();
    const view = renderHook(() => useVideoFrameLoop({ current: video }, paint));
    loop.tick();
    fireEvent.seeked(video);
    const calls = paint.mock.calls.length;
    loop.tick();
    expect(paint).toHaveBeenCalledTimes(calls + 1);
    view.unmount();
    expect(loop.pending.size).toBe(0);
  });

  it("paints a paused seek once and does not keep polling", () => {
    const video = document.createElement("video");
    const loop = frames();
    const paint = vi.fn();
    renderHook(() => useVideoFrameLoop({ current: video }, paint));
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledTimes(1);
    expect(loop.pending.size).toBe(0);
  });

  it("cancels presented frame callbacks when disabled", () => {
    const video = document.createElement("video");
    const callbacks = new Map<number, VideoFrameRequestCallback>();
    let nextId = 1;
    video.requestVideoFrameCallback = vi.fn((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    video.cancelVideoFrameCallback = vi.fn((id) => callbacks.delete(id));
    const paint = vi.fn();
    const mediaRef = { current: video };
    const view = renderHook((enabled) => useVideoFrameLoop(mediaRef, paint, enabled), {
      initialProps: true,
    });
    const callback = callbacks.get(1)!;
    callbacks.delete(1);
    act(() => callback(0, {} as VideoFrameCallbackMetadata));
    expect(paint).toHaveBeenCalledTimes(1);
    view.rerender(false);
    expect(callbacks.size).toBe(0);
  });
});
