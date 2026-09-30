import { useEffect, useRef, type RefObject } from "react";

export function useVideoFrameLoop(
  mediaRef: RefObject<HTMLElement | null>,
  onFrame: () => void,
  enabled = true,
): void {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const media = mediaRef.current;
    if (!enabled || !(media instanceof HTMLVideoElement)) return;

    const paint = () => onFrameRef.current();
    let frame = 0;
    let stopped = false;

    if (typeof media.requestVideoFrameCallback === "function") {
      const onVideoFrame = () => {
        paint();
        if (!stopped) frame = media.requestVideoFrameCallback(onVideoFrame);
      };
      frame = media.requestVideoFrameCallback(onVideoFrame);

      return () => {
        stopped = true;
        media.cancelVideoFrameCallback(frame);
      };
    }

    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      paint();
    };
    const settled = () => {
      paint();
      if (!media.paused) start();
    };

    media.addEventListener("play", start);
    media.addEventListener("playing", start);
    media.addEventListener("pause", stop);
    media.addEventListener("seeked", settled);
    media.addEventListener("loadeddata", settled);
    media.addEventListener("canplay", settled);
    if (!media.paused) start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      media.removeEventListener("play", start);
      media.removeEventListener("playing", start);
      media.removeEventListener("pause", stop);
      media.removeEventListener("seeked", settled);
      media.removeEventListener("loadeddata", settled);
      media.removeEventListener("canplay", settled);
    };
  }, [enabled, mediaRef]);
}
