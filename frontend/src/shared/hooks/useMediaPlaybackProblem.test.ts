import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyntheticEvent } from "react";
import { MEDIA_STALL_MS } from "@/shared/lib/mediaProblems";
import { useMediaPlaybackProblem } from "./useMediaPlaybackProblem";

function videoEvent(video: Partial<HTMLVideoElement>): SyntheticEvent<HTMLVideoElement> {
  return { currentTarget: video } as SyntheticEvent<HTMLVideoElement>;
}

describe("useMediaPlaybackProblem", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("names an error by its code", () => {
    const { result } = renderHook(() => useMediaPlaybackProblem("/clip.mp4"));

    act(() => result.current.mediaProps.onError(videoEvent({ error: { code: 3 } as MediaError })));

    expect(result.current.problem).toBe("decode");
  });

  it("reports a file with sound but no picture", () => {
    const { result } = renderHook(() => useMediaPlaybackProblem("/clip.mp4"));

    act(() => result.current.noteMetadata({ videoWidth: 0 } as HTMLVideoElement));

    expect(result.current.problem).toBe("no-picture");
  });

  it("calls a video that never loads stuck rather than loading", () => {
    const { result } = renderHook(() => useMediaPlaybackProblem("/clip.mp4"));

    act(() => vi.advanceTimersByTime(MEDIA_STALL_MS));

    expect(result.current.problem).toBe("stalled");
  });

  it("leaves a video that loaded alone", () => {
    const { result } = renderHook(() => useMediaPlaybackProblem("/clip.mp4"));

    act(() => result.current.noteMetadata({ videoWidth: 64 } as HTMLVideoElement));
    act(() => vi.advanceTimersByTime(MEDIA_STALL_MS));

    expect(result.current.problem).toBeNull();
  });

  it("clears on retry and remounts the element, and forgets a problem when the file changes", () => {
    const { result, rerender } = renderHook(({ src }) => useMediaPlaybackProblem(src), {
      initialProps: { src: "/clip.mp4" },
    });
    act(() => result.current.mediaProps.onError(videoEvent({ error: null })));

    act(() => result.current.retry());
    expect(result.current.problem).toBeNull();
    expect(result.current.retryKey).toBe(1);

    act(() => result.current.mediaProps.onError(videoEvent({ error: null })));
    rerender({ src: "/clip.mp4?v=2" });
    expect(result.current.problem).toBeNull();
  });
});
