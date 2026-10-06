import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { trackPercent } from "@/features/gallery/lib/videoEdit";
import { VideoPreviewLoop } from "@/features/gallery/lib/videoPreviewLoop";

export interface PlaybackRange {
  start: number;
  end: number;
}

export interface UseVideoPreviewPlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  standbyVideoRef?: RefObject<HTMLVideoElement | null>;
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
  activeMediaRef: RefObject<HTMLVideoElement | null>;
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
  const { videoRef, standbyVideoRef, active, itemPath } = options;

  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const [activeMediaRef, setActiveMediaRef] = useState(videoRef);
  const loopRef = useRef<VideoPreviewLoop | null>(null);

  // Ref so the frame loop reads current values without re-subscribing between frames.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const seekTo = useCallback(
    (seconds: number) => {
      const loop = loopRef.current;
      const video = loop?.current ?? videoRef.current;
      if (!video) return;
      // The standby waits at the in point whatever the playhead does; only a handoff is undone.
      const resume = loop?.cancelHandoff();
      video.currentTime = seconds;
      setPlayheadTime(seconds);
      if (resume) loop?.play();
    },
    [videoRef],
  );

  const syncFrom = useCallback((video: HTMLVideoElement) => {
    setPlaying(!video.paused);
    setPlayheadTime(video.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const loop = loopRef.current;
    const video = loop?.current ?? videoRef.current;
    if (!video) return;
    // Mid-handoff both players are paused, so no pause event would report the stop.
    if (loop?.cancelHandoff() || !video.paused) {
      video.pause();
      setPlaying(false);
      setPlayheadTime(video.currentTime);
      return;
    }

    // Both edges: parked ahead of the in point it would otherwise play the dropped head first.
    const { start, end } = optionsRef.current.getRange();
    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
    }
    if (loop) loop.play();
    else void video.play().catch(() => setPlaying(false));
  }, [videoRef]);

  useEffect(() => {
    const primary = videoRef.current;
    setActiveMediaRef(videoRef);
    if (!primary || !active) return;
    const refs = standbyVideoRef?.current ? [videoRef, standbyVideoRef] : [videoRef];
    const videos = refs.map((ref) => ref.current!);
    let frame = 0;
    const loop = new VideoPreviewLoop({
      videos,
      getRange: () => optionsRef.current.getRange(),
      getFrameDuration: () => optionsRef.current.frameDuration,
      onSwitch: (index) => {
        setActiveMediaRef(refs[index]);
        setPlayheadTime(loop.current.currentTime);
      },
      onPlayError: () => {
        setPlaying(false);
        stop();
      },
    });
    loopRef.current = loop;

    syncFrom(primary);

    // A seek settling a frame short of the in point is not a take that has run out.
    const outOfBand = () => {
      const video = loop.current;
      const { start, end } = optionsRef.current.getRange();
      return (
        video.currentTime >= end || video.currentTime < start - optionsRef.current.frameDuration
      );
    };
    const tick = () => {
      const video = loop.current;
      if (!video.paused && outOfBand()) loop.lap();
      const marker = playheadRef.current;
      if (marker) {
        // Straight to the node: through state this would re-render the modal every frame.
        marker.style.left = trackPercent(loop.current.currentTime, optionsRef.current.duration);
      }
      frame = !loop.current.paused || loop.handingOff ? requestAnimationFrame(tick) : 0;
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setPlayheadTime(loop.current.currentTime);
    };

    const handlePlay = (video: HTMLVideoElement) => {
      if (video !== loop.current) return;
      setPlaying(true);
      start();
    };
    const handlePause = (video: HTMLVideoElement) => {
      if (video !== loop.current || loop.handingOff) return;
      setPlaying(false);
      stop();
    };
    // The element stops itself at the end of the file, where no frame of ours can reach it.
    const handleEnded = (video: HTMLVideoElement) => {
      if (video !== loop.current) return;
      loop.lap();
      if (loop.handingOff) {
        setPlaying(true);
        start();
      }
    };
    // Frames are throttled to about one a second in a background tab; playback is not.
    const handleTimeUpdate = (video: HTMLVideoElement) => {
      if (video === loop.current && !video.paused && outOfBand()) loop.lap();
    };
    // The element snaps to a frame; without this the marker keeps the time we asked for.
    const handleSeeked = (video: HTMLVideoElement) => {
      if (video === loop.current && video.paused && !loop.handingOff) {
        setPlayheadTime(video.currentTime);
      }
    };

    const handlers = {
      play: handlePlay,
      playing: handlePlay,
      pause: handlePause,
      ended: handleEnded,
      timeupdate: handleTimeUpdate,
      seeked: handleSeeked,
    };
    const cleanups = videos.flatMap((video) =>
      Object.entries(handlers).map(([type, handler]) => {
        const listener = () => handler(video);
        video.addEventListener(type, listener);
        return () => video.removeEventListener(type, listener);
      }),
    );
    loop.prepare();
    if (!primary.paused) start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      cleanups.forEach((cleanup) => cleanup());
      loop.dispose();
      loopRef.current = null;
    };
  }, [active, itemPath, standbyVideoRef, syncFrom, videoRef]);

  const { start: trimStart, end: trimEnd } = options.getRange();
  useEffect(() => {
    const loop = loopRef.current;
    const resume = loop?.handingOff;
    loop?.prepare();
    if (resume) loop?.play();
  }, [trimStart, trimEnd]);

  // After the commit that redrew the marker from state, or it flicks back a frame on pause.
  useEffect(() => {
    if (playing) return;
    const marker = playheadRef.current;
    if (marker) marker.style.left = "";
  }, [playing, playheadTime]);

  return { activeMediaRef, playing, playheadTime, playheadRef, seekTo, togglePlay, syncFrom };
}
