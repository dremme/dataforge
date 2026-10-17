import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EngineListener, PreviewEngine } from "@/features/videoEditor/lib/previewEngine";
import { usePlayheadTime } from "./usePlayhead";

function fakeEngine(playing: boolean) {
  const listeners = new Set<EngineListener>();
  const engine = {
    currentTime: 0,
    isPlaying: playing,
    subscribe: (listener: EngineListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (time: number) => {
    engine.currentTime = time;
    for (const listener of listeners) listener(time);
  };
  return { engine: engine as unknown as PreviewEngine, emit };
}

describe("usePlayheadTime", () => {
  it("shows every paused seek at once, so the inspector keys the time it shows", () => {
    const { engine, emit } = fakeEngine(false);
    const { result } = renderHook(() => usePlayheadTime(engine));

    act(() => emit(3));
    act(() => emit(2.9));
    expect(result.current).toBe(2.9);
  });

  it("holds back readouts between frames while playing", () => {
    const { engine, emit } = fakeEngine(true);
    const { result } = renderHook(() => usePlayheadTime(engine));

    act(() => emit(1));
    act(() => emit(1.016));
    expect(result.current).toBe(1);
  });
});
