import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  applyVideoEdit,
  cancelVideoEdit,
  fetchVideoEditState,
  revertVideoEdit,
} from "@/features/gallery/api/videoEdit";
import {
  aspectIdForCrop,
  cropForAspect,
  CROP_ASPECTS,
  type CropRect,
} from "@/features/gallery/lib/crop";
import {
  clampTrimEnd,
  clampTrimStart,
  draftFromSpec,
  emptyDraft,
  isIdentityEdit,
  outputDimensions,
  outputDuration,
  specsEqual,
  toVideoEditSpec,
  type VideoEditDraft,
} from "@/features/gallery/lib/videoEdit";
import { hasUsableDuration, formatFrameTime } from "@/features/gallery/lib/videoFrameCapture";
import { formatApiError } from "@/shared/api/http";
import { useServerEvent } from "@/shared/events/serverEvents";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem, VideoEditSpec } from "@/shared/types";

/** How close to the out point playback may drift before it loops back to the in point. */
const LOOP_EPSILON = 0.03;

export interface UseVideoEditOptions {
  item: GalleryItem | undefined;
  /** Shared with frame capture: one `<video>`, one active mode. */
  videoRef: RefObject<HTMLVideoElement | null>;
  onEdited?: () => void | Promise<void>;
  /** Owned by the modal so the mode sticks across next/prev. */
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
}

export interface VideoEdit {
  editMode: boolean;
  ready: boolean;
  applying: boolean;
  /** Null when the output length could not be predicted. */
  progress: number | null;
  draft: VideoEditDraft;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  hasBackup: boolean;
  dirty: boolean;
  cropActive: boolean;
  aspectId: string;
  aspectRatio: number | null;
  muted: boolean;
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
  selectAspect: (aspectId: string) => void;
  toggleMuted: () => void;
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

export function useVideoEdit(options: UseVideoEditOptions): VideoEdit {
  const notify = useNotify();
  const { item, videoRef, editMode, setEditMode } = options;

  // Ref so callbacks stay dependency-free; an apply outliving a swap keeps its starting values.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const applyingRef = useRef(false);

  const [duration, setDuration] = useState(Number.NaN);
  const [sourceWidth, setSourceWidth] = useState(0);
  const [sourceHeight, setSourceHeight] = useState(0);
  const [draft, setDraft] = useState<VideoEditDraft>(() => emptyDraft(Number.NaN));
  // Spec (no duration) so it survives the gap between an item swap and the new element reporting one.
  const [savedSpec, setSavedSpec] = useState<VideoEditSpec | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [aspectId, setAspectId] = useState("free");
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [cropActive, setCropActive] = useState(false);
  // Sticky across items; remounts pick it up from the muted effect and handleLoadedMetadata.
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const savedSpecRef = useRef(savedSpec);
  savedSpecRef.current = savedSpec;
  const sourceRef = useRef({ width: sourceWidth, height: sourceHeight });
  sourceRef.current = { width: sourceWidth, height: sourceHeight };

  const path = item?.path;
  const ready = hasUsableDuration(duration) && sourceWidth > 0 && sourceHeight > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keyed on path alone: has_backup would clear duration on apply (loadedmetadata never re-fires),
  // and applying/cropActive must stay out or they race the previous item / drop handles on next/prev.
  useEffect(() => {
    setDuration(Number.NaN);
    setSourceWidth(0);
    setSourceHeight(0);
    setDraft(emptyDraft(Number.NaN));
    setSavedSpec(null);
    setAspectId("free");
    setPlaying(false);
    setPlayheadTime(0);
  }, [path]);

  // Separate so a listing that learns about a backup does not reset the editor.
  useEffect(() => {
    setHasBackup(item?.has_backup ?? false);
  }, [item?.path, item?.has_backup]);

  useServerEvent((event) => {
    if (event.type !== "video_edit") return;
    if (!optionsRef.current.item || event.path !== optionsRef.current.item.path) return;

    setProgress(
      event.duration && event.duration > 0
        ? Math.min(1, Math.max(0, event.seconds / event.duration))
        : null,
    );
  });

  // Metadata only; the fetch below seeds the draft once this has a duration.
  const handleLoadedMetadata = useCallback((video: HTMLVideoElement) => {
    const previousDuration = durationRef.current;
    setDuration(video.duration);
    setSourceWidth(video.videoWidth);
    setSourceHeight(video.videoHeight);

    // Same duration is not a new source; treating it as one would wipe a draft in progress.
    if (!hasUsableDuration(video.duration) || previousDuration === video.duration) return;

    setDraft(emptyDraft(video.duration));

    // Sticky mode remounts a fresh `<video autoPlay>`; pause so playback stays off the timeline.
    if (optionsRef.current.editMode) {
      video.pause();
      video.currentTime = 0;
      video.muted = mutedRef.current;
      setPlaying(false);
      setPlayheadTime(0);
    }
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = seconds;
      setPlayheadTime(seconds);
    },
    [videoRef],
  );

  const seedDraft = useCallback(
    (spec: VideoEditSpec | null, forDuration: number) => {
      const seeded = draftFromSpec(spec, forDuration);
      setDraft(seeded);
      setAspectId(aspectIdForCrop(seeded.crop, sourceRef.current));
      seekTo(seeded.trimStart);
    },
    [seekTo],
  );

  // Wait for a real duration: seeding against NaN collapsed the timeline to 0:00-0:00.
  // Keyed on path, not the item object, so a folder refresh cannot throw away a draft in progress.
  useEffect(() => {
    if (!editMode || !path || !hasUsableDuration(duration)) return;

    let cancelled = false;
    void (async () => {
      try {
        const state = await fetchVideoEditState(path);
        if (cancelled || !mountedRef.current) return;
        setHasBackup(state.has_backup);
        setSavedSpec(state.spec ?? null);
        seedDraft(state.spec ?? null, duration);
      } catch {
        // Missing spec: open on an empty draft like an unedited file.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMode, path, duration, seedDraft]);

  // Re-run on item path as well as mode: the video remounts on both, and a ref never re-runs,
  // so sticky-mode navigation used to leave these listeners on a discarded element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editMode) return;

    setPlaying(!video.paused);
    setPlayheadTime(video.currentTime);

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
  }, [editMode, item?.path, videoRef]);

  // Preview plays every source frame at the chosen rate; setpts drops frames instead.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = editMode ? draft.speed : 1;
  }, [draft.speed, editMode, videoRef]);

  // Editing only; elsewhere the muted attribute and native controls own volume.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editMode) return;
    video.muted = muted;
  }, [editMode, muted, videoRef]);

  const toggleMuted = useCallback(() => {
    setMuted((current) => !current);
  }, []);

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

  // Owned here so it resets with the item and restores with a stored spec.
  const selectAspect = useCallback((nextAspectId: string) => {
    setAspectId(nextAspectId);

    // Free only releases the lock; keep the rectangle the user already shaped.
    const ratio = CROP_ASPECTS.find((aspect) => aspect.id === nextAspectId)?.ratio ?? null;
    if (ratio === null) return;

    setCropActive(true);
    // Frame fractions, so the source's own aspect divides out first.
    const frame = sourceRef.current.width / sourceRef.current.height;
    if (!Number.isFinite(frame) || frame <= 0) return;
    setDraft((current) => ({ ...current, crop: cropForAspect(ratio / frame) }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setDraft((current) => ({ ...current, speed }));
  }, []);

  const setScale = useCallback((scale: number) => {
    setDraft((current) => ({ ...current, scale }));
  }, []);

  const resetDraft = useCallback(() => {
    seedDraft(savedSpecRef.current, durationRef.current);
  }, [seedDraft]);

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
      settle: () => void,
    ) => {
      // Ref guard: a double click lands before applying has re-rendered the button disabled.
      if (applyingRef.current) return;

      const { item: currentItem, onEdited } = optionsRef.current;
      if (!currentItem) return;

      // Snapshotted so an item swap mid-render cannot retarget the write.
      const mediaPath = currentItem.path;
      const name = currentItem.name;

      applyingRef.current = true;
      setApplying(true);
      setProgress(null);

      void (async () => {
        try {
          const result = await request(mediaPath);
          if (mountedRef.current) setHasBackup(result.has_backup);
          notify({ variant: "success", message: describe(name) });
          await onEdited?.();
          // settle records what is now on disk so Apply stays quiet until the next change.
          if (mountedRef.current) settle();
        } catch (error) {
          // Unguarded by mountedRef: the store outlives this modal, so a finish after close reports.
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
    [notify],
  );

  const revert = useCallback(() => {
    runEdit(
      revertVideoEdit,
      (name) => `Restored the original ${name}.`,
      () => {
        setSavedSpec(null);
        seedDraft(null, durationRef.current);
      },
    );
  }, [runEdit, seedDraft]);

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;
    const currentDuration = durationRef.current;

    // Identity draft restores the backup instead of re-encoding; else only Revert returns to 1x.
    if (isIdentityEdit(currentDraft, currentDuration)) {
      revert();
      return;
    }

    const spec = toVideoEditSpec(currentDraft, currentDuration);
    const seconds = outputDuration(currentDraft);

    runEdit(
      (mediaPath) => applyVideoEdit(mediaPath, spec),
      (name) => `Edited ${name} - ${formatFrameTime(seconds)} long.`,
      () => setSavedSpec(spec),
    );
  }, [revert, runEdit]);

  const cancel = useCallback(() => {
    const currentItem = optionsRef.current.item;
    if (!currentItem || !applyingRef.current) return;
    void cancelVideoEdit(currentItem.path);
  }, []);

  // Dirty vs disk, not an untouched source: an identity draft after a write means Revert.
  const dirty =
    ready &&
    (savedSpec === null
      ? !isIdentityEdit(draft, duration)
      : !specsEqual(toVideoEditSpec(draft, duration), savedSpec));

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
    dirty,
    cropActive,
    aspectId,
    aspectRatio: CROP_ASPECTS.find((aspect) => aspect.id === aspectId)?.ratio ?? null,
    muted,
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
    selectAspect,
    toggleMuted,
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
