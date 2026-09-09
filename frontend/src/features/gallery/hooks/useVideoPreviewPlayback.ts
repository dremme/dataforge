import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { trackPercent } from "@/features/gallery/lib/videoEdit";

export interface PlaybackRange {
  start: number;
  end: number;
}

export interface UseVideoPreviewPlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Edit mode: elsewhere the native controls own the element. */
  active: boolean;
  /** The element remounts on this, and a ref never re-runs an effect. */
  itemPath: string | undefined;
  duration: number;
  frameDuration: number;
  /** Read every frame, so a handle dragged mid-playback takes effect on the next lap. */
  getRange: () => PlaybackRange;
}

export interface VideoPreviewPlayback {
  playing: boolean;
  /** Discrete positions only - a seek, a pause, a lap. Playback moves the marker itself. */
  playheadTime: number;
  playheadRef: RefObject<HTMLDivElement | null>;
  seekTo: (seconds: number) => void;
  togglePlay: () => void;
  syncFrom: (video: HTMLVideoElement) => void;
}

/**
 * Keeps preview playback inside the trim band and drives the marker, on frames rather than on
 * `timeupdate`: four events a second overshoot the out point and step the marker.
 */
export function useVideoPreviewPlayback(
  options: UseVideoPreviewPlaybackOptions,
): VideoPreviewPlayback {
  const { videoRef, active, itemPath } = options;

  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // Ref so the frame loop reads current values without re-subscribing between frames.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      setPlayheadTime(seconds);
    },
    [videoRef],
  );

  const syncFrom = useCallback((video: HTMLVideoElement) => {
    setPlaying(!video.paused);
    setPlayheadTime(video.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }

    // Both edges: parked ahead of the in point it would otherwise play the dropped head first.
    const { start, end } = optionsRef.current.getRange();
    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
    }
    void video.play();
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;

    syncFrom(video);

    // A seek settling a frame short of the in point is not a take that has run out.
    const outOfBand = () => {
      const { start, end } = optionsRef.current.getRange();
      return (
        video.currentTime >= end || video.currentTime < start - optionsRef.current.frameDuration
      );
    };
    const rewind = () => {
      video.currentTime = optionsRef.current.getRange().start;
    };

    let frame = 0;

    const tick = () => {
      if (outOfBand()) rewind();
      const marker = playheadRef.current;
      if (marker) {
        // Straight to the node: through state this would re-render the modal every frame.
        marker.style.left = trackPercent(video.currentTime, optionsRef.current.duration);
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setPlayheadTime(video.currentTime);
    };

    const handlePlay = () => {
      setPlaying(true);
      start();
    };
    const handlePause = () => {
      setPlaying(false);
      stop();
    };
    // The element stops itself at the end of the file, where no frame of ours can reach it.
    const handleEnded = () => {
      rewind();
      void video.play();
    };
    // Frames are throttled to about one a second in a background tab; playback is not.
    const handleTimeUpdate = () => {
      if (!video.paused && outOfBand()) rewind();
    };
    // The element snaps to a frame; without this the marker keeps the time we asked for.
    const handleSeeked = () => {
      if (video.paused) setPlayheadTime(video.currentTime);
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("playing", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("seeked", handleSeeked);
    if (!video.paused) start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("playing", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [active, itemPath, syncFrom, videoRef]);

  // After the commit that redrew the marker from state, or it flicks back a frame on pause.
  useEffect(() => {
    if (playing) return;
    const marker = playheadRef.current;
    if (marker) marker.style.left = "";
  }, [playing, playheadTime]);

  return { playing, playheadTime, playheadRef, seekTo, togglePlay, syncFrom };
}
