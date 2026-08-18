import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  applyVideoEdit,
  cancelVideoEdit,
  fetchVideoEditState,
  revertVideoEdit,
} from "@/features/gallery/api/videoEdit";
import {
  clampTrimEnd,
  clampTrimStart,
  draftFromSpec,
  emptyDraft,
  isIdentityEdit,
  outputDimensions,
  outputDuration,
  toVideoEditSpec,
  type CropRect,
  type VideoEditDraft,
} from "@/features/gallery/lib/videoEdit";
import { hasUsableDuration, formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import { formatApiError } from "@/shared/api/http";
import { useServerEvent } from "@/shared/events/serverEvents";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

/** How close to the out point playback may drift before it loops back to the in point. */
const LOOP_EPSILON = 0.03;

export interface UseVideoEditOptions {
  item: GalleryItem | undefined;
  /** Shared with the frame-capture hook: there is one `<video>` and one active mode. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Runs once the new file is on disk, so the owner can reload the folder. */
  onEdited?: () => void | Promise<void>;
  /**
   * Owned by the modal so the mode sticks across next/prev, exactly as frame capture's
   * does. This hook only drives enter/exit and reads the flag for its UI.
   */
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
}

export interface VideoEdit {
  editMode: boolean;
  /** Metadata has landed, so the timeline has a real range and the crop a real frame. */
  ready: boolean;
  applying: boolean;
  /** 0..1 while rendering, or null when the output length could not be predicted. */
  progress: number | null;
  draft: VideoEditDraft;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  hasBackup: boolean;
  dirty: boolean;
  cropActive: boolean;
  playing: boolean;
  playheadTime: number;
  outputWidth: number;
  outputHeight: number;
  outputSeconds: number;
  toggleEditMode: () => void;
  exitEditMode: () => void;
  setTrimStart: (seconds: number) => void;
  setTrimEnd: (seconds: number) => void;
  setTrimStartAtPlayhead: () => void;
  setTrimEndAtPlayhead: () => void;
  setCrop: (crop: CropRect) => void;
  setCropActive: (active: boolean) => void;
  setSpeed: (speed: number) => void;
  setScale: (scale: number) => void;
  seekTo: (seconds: number) => void;
  togglePlay: () => void;
  resetDraft: () => void;
  apply: () => void;
  cancel: () => void;
  revert: () => void;
  handleLoadedMetadata: (video: HTMLVideoElement) => void;
}

/**
 * Editing mode for the gallery's video viewer: describe the whole edit, then render it
 * from the untouched original in one pass.
 *
 * The draft is expressed against that original, never against the last render, which is
 * why the modal plays the original while this is on. Re-opening on an edited file seeds
 * the draft from the spec stored beside it, so changing one value keeps the rest.
 */
export function useVideoEdit(options: UseVideoEditOptions): VideoEdit {
  const notify = useNotify();
  const { item, videoRef, editMode, setEditMode } = options;

  // Read through a ref so every returned callback is dependency-free, and so an apply
  // that outlives an item swap still finishes against the values it started with.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const applyingRef = useRef(false);

  const [duration, setDuration] = useState(Number.NaN);
  const [sourceWidth, setSourceWidth] = useState(0);
  const [sourceHeight, setSourceHeight] = useState(0);
  const [draft, setDraft] = useState<VideoEditDraft>(() => emptyDraft(Number.NaN));
  const [savedDraft, setSavedDraft] = useState<VideoEditDraft | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [cropActive, setCropActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const ready = hasUsableDuration(duration) && sourceWidth > 0 && sourceHeight > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `applying` is deliberately absent: a render in flight against the previous item must
  // run its own `finally`, and clearing the flag here would race it.
  useEffect(() => {
    setDuration(Number.NaN);
    setSourceWidth(0);
    setSourceHeight(0);
    setDraft(emptyDraft(Number.NaN));
    setSavedDraft(null);
    setHasBackup(item?.has_backup ?? false);
    setCropActive(false);
    setPlaying(false);
    setPlayheadTime(0);
  }, [item?.path, item?.has_backup]);

  // The stored spec is what makes re-editing coherent. Loading it on entry rather than
  // with the listing keeps it off the path every folder navigation waits for.
  useEffect(() => {
    if (!editMode || !item) return;

    let cancelled = false;
    void (async () => {
      try {
        const state = await fetchVideoEditState(item.path);
        if (cancelled || !mountedRef.current) return;
        setHasBackup(state.has_backup);
        setSavedDraft(state.spec ? draftFromSpec(state.spec, durationRef.current) : null);
        setDraft(draftFromSpec(state.spec, durationRef.current));
      } catch {
        // A missing spec is not worth a toast: the panel simply opens on an empty draft,
        // which is what an unedited file gets anyway.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMode, item, duration]);

  useServerEvent((event) => {
    if (event.type !== "video_edit") return;
    if (!optionsRef.current.item || event.path !== optionsRef.current.item.path) return;

    setProgress(
      event.duration && event.duration > 0
        ? Math.min(1, Math.max(0, event.seconds / event.duration))
        : null,
    );
  });

  const handleLoadedMetadata = useCallback(
    (video: HTMLVideoElement) => {
      setDuration(video.duration);
      setSourceWidth(video.videoWidth);
      setSourceHeight(video.videoHeight);

      if (!hasUsableDuration(video.duration)) return;

      const seeded = draftFromSpec(
        optionsRef.current.editMode && savedDraft
          ? toVideoEditSpec(savedDraft, video.duration)
          : null,
        video.duration,
      );
      setDraft(seeded);

      // Sticky mode remounts a fresh `<video autoPlay>` under an already-open panel;
      // pause and park on the in point so playback does not run behind the timeline.
      if (optionsRef.current.editMode) {
        video.pause();
        video.currentTime = seeded.trimStart;
        setPlaying(false);
      }
    },
    [savedDraft],
  );

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      setPlayheadTime(seconds);
    },
    [videoRef],
  );

  // Playback is clamped to the kept span rather than merely started there: dialling in
  // an out point is a lot of small adjustments, and each one should replay the result.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editMode) return;

    const handleTimeUpdate = () => {
      const { trimStart, trimEnd } = draftRef.current;
      if (video.currentTime >= trimEnd - LOOP_EPSILON || video.currentTime < trimStart - 0.5) {
        video.currentTime = trimStart;
      }
      setPlayheadTime(video.currentTime);
    };
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, [editMode, videoRef]);

  // The preview is honest about speed, and deliberately flattering about slow motion:
  // the browser plays every source frame at half rate, where `setpts` produces a file
  // with half the frames. Do not "fix" the preview to match without saying so.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = editMode ? draft.speed : 1;
  }, [draft.speed, editMode, videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= draftRef.current.trimEnd - LOOP_EPSILON) {
        video.currentTime = draftRef.current.trimStart;
      }
      void video.play();
      return;
    }
    video.pause();
  }, [videoRef]);

  const setTrimStart = useCallback(
    (seconds: number) => {
      const next = clampTrimStart(seconds, draftRef.current, durationRef.current);
      setDraft((current) => ({ ...current, trimStart: next }));
      seekTo(next);
    },
    [seekTo],
  );

  const setTrimEnd = useCallback(
    (seconds: number) => {
      const next = clampTrimEnd(seconds, draftRef.current, durationRef.current);
      setDraft((current) => ({ ...current, trimEnd: next }));
      seekTo(Math.max(draftRef.current.trimStart, next - LOOP_EPSILON));
    },
    [seekTo],
  );

  const setTrimStartAtPlayhead = useCallback(() => {
    const video = videoRef.current;
    if (video) setTrimStart(video.currentTime);
  }, [setTrimStart, videoRef]);

  const setTrimEndAtPlayhead = useCallback(() => {
    const video = videoRef.current;
    if (video) setTrimEnd(video.currentTime);
  }, [setTrimEnd, videoRef]);

  const setCrop = useCallback((crop: CropRect) => {
    setDraft((current) => ({ ...current, crop }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setDraft((current) => ({ ...current, speed }));
  }, []);

  const setScale = useCallback((scale: number) => {
    setDraft((current) => ({ ...current, scale }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraft(savedDraft ?? emptyDraft(durationRef.current));
  }, [savedDraft]);

  const enterEditMode = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      setPlaying(false);
    }
    setEditMode(true);
  }, [setEditMode, videoRef]);

  const exitEditMode = useCallback(() => {
    setCropActive(false);
    setEditMode(false);
  }, [setEditMode]);

  const toggleEditMode = useCallback(() => {
    if (applyingRef.current) return;
    if (editMode) {
      exitEditMode();
      return;
    }
    enterEditMode();
  }, [editMode, enterEditMode, exitEditMode]);

  const runEdit = useCallback(
    (
      request: (path: string) => Promise<{ has_backup: boolean; width?: number | null }>,
      describe: (path: string) => string,
    ) => {
      // The guard reads a ref: a double click lands before `applying` has re-rendered
      // the button into its disabled form.
      if (applyingRef.current) return;

      const { item: currentItem, onEdited } = optionsRef.current;
      if (!currentItem) return;

      // Snapshotted so an item swap mid-render cannot retarget the write.
      const path = currentItem.path;
      const name = currentItem.name;

      applyingRef.current = true;
      setApplying(true);
      setProgress(null);

      void (async () => {
        try {
          const result = await request(path);
          if (mountedRef.current) setHasBackup(result.has_backup);
          notify({ variant: "success", message: describe(name) });
          await onEdited?.();
          // Leaving the mode is what puts the result on screen: the modal swaps back to
          // the rendered file, where staying would keep showing the original.
          if (mountedRef.current) exitEditMode();
        } catch (error) {
          // Unguarded by `mountedRef`: the notification store outlives this modal, so a
          // render that finishes after a close still reports.
          notify({
            variant: "danger",
            message: `Could not edit ${name}: ${formatApiError(error)}`,
          });
        } finally {
          applyingRef.current = false;
          if (mountedRef.current) {
            setApplying(false);
            setProgress(null);
          }
        }
      })();
    },
    [exitEditMode, notify],
  );

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;
    const currentDuration = durationRef.current;
    const spec = toVideoEditSpec(currentDraft, currentDuration);
    const seconds = outputDuration(currentDraft);

    runEdit(
      (path) => applyVideoEdit(path, spec),
      (name) => `Edited ${name} - ${formatFrameTime(seconds)} long.`,
    );
  }, [runEdit]);

  const revert = useCallback(() => {
    runEdit(revertVideoEdit, (name) => `Restored the original ${name}.`);
  }, [runEdit]);

  const cancel = useCallback(() => {
    const currentItem = optionsRef.current.item;
    if (!currentItem || !applyingRef.current) return;
    void cancelVideoEdit(currentItem.path);
  }, []);

  const output = outputDimensions(
    { width: sourceWidth, height: sourceHeight },
    draft.crop,
    draft.scale,
  );

  return {
    editMode,
    ready,
    applying,
    progress,
    draft,
    duration,
    sourceWidth,
    sourceHeight,
    hasBackup,
    dirty: ready && !isIdentityEdit(draft, duration),
    cropActive,
    playing,
    playheadTime,
    outputWidth: output.width,
    outputHeight: output.height,
    outputSeconds: outputDuration(draft),
    toggleEditMode,
    exitEditMode,
    setTrimStart,
    setTrimEnd,
    setTrimStartAtPlayhead,
    setTrimEndAtPlayhead,
    setCrop,
    setCropActive,
    setSpeed,
    setScale,
    seekTo,
    togglePlay,
    resetDraft,
    apply,
    cancel,
    revert,
    handleLoadedMetadata,
  };
}
