import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  MEDIA_STALL_MS,
  problemFromError,
  type MediaProblemKind,
} from "@/shared/lib/mediaProblems";

/**
 * Why a `<video>` is not showing `src`, or null while it plays or may still load. An error,
 * metadata with no picture, or nothing loaded after `MEDIA_STALL_MS` each name a problem, so
 * a file the browser cannot decode never looks like one still loading.
 *
 * Spread `mediaProps` onto the element, call `noteMetadata` from its `loadedmetadata`, and
 * include `retryKey` in its `key`: a retry remounts it.
 */
export function useMediaPlaybackProblem(src: string | undefined) {
  const [failure, setFailure] = useState<{ src: string; kind: MediaProblemKind } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const loadedRef = useRef<string | null>(null);

  const fail = useCallback(
    (kind: MediaProblemKind) => {
      if (src) setFailure({ src, kind });
    },
    [src],
  );

  useEffect(() => {
    if (!src) return;
    loadedRef.current = null;
    const timer = setTimeout(() => {
      if (loadedRef.current !== src) setFailure({ src, kind: "stalled" });
    }, MEDIA_STALL_MS);
    return () => clearTimeout(timer);
  }, [retryKey, src]);

  const retry = useCallback(() => {
    setFailure(null);
    setRetryKey((key) => key + 1);
  }, []);

  /** Call from the element's `loadedmetadata`; a paused `preload="metadata"` gets no further. */
  const noteMetadata = useCallback(
    (video: HTMLVideoElement) => {
      loadedRef.current = src ?? null;
      // Sound with no decodable picture: how Chrome can treat an MPEG-4 Part 2 track.
      if (video.videoWidth === 0) fail("no-picture");
    },
    [fail, src],
  );

  const mediaProps = {
    onError: (event: SyntheticEvent<HTMLVideoElement>) =>
      fail(problemFromError(event.currentTarget.error)),
  };

  return {
    problem: failure && failure.src === src ? failure.kind : null,
    retry,
    retryKey,
    mediaProps,
    noteMetadata,
  };
}
