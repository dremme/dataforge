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
  /** Which of `CROP_ASPECTS` the crop is locked to; "free" for none. */
  aspectId: string;
  /** That lock's width over height, or null. The overlay's handles honour it. */
  aspectRatio: number | null;
  /** Whether the preview is silent. The element is muted everywhere else. */
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
  // What is on disk, as a spec rather than a draft: a spec carries no duration, so it
  // survives the window between an item swap and the new element reporting one.
  const [savedSpec, setSavedSpec] = useState<VideoEditSpec | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [aspectId, setAspectId] = useState("free");
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [cropActive, setCropActive] = useState(false);
  // Not reset with the item: this is a volume setting, and those stay where you put
  // them. The element is remounted per item and per mode, so the effect below and
  // `handleLoadedMetadata` are what carry the choice onto each new one.
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

  // Keyed on the path alone. `has_backup` must stay out of it: an apply flips that field
  // when the folder reloads, and since the element is not reloaded with it - the editor
  // was already playing the original - nothing would fire `loadedmetadata` a second time
  // to put back the duration and frame size this clears.
  //
  // `applying` is deliberately absent for a different reason: a render in flight against
  // the previous item must run its own `finally`, and clearing the flag here would race it.
  // `cropActive` is deliberately absent: it is the crop tool being selected, and the tool
  // outlives the item exactly as the mode does. Clearing it here left the panel showing
  // the crop tool with no handles on the frame after every next/prev.
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

  // Seeded separately so a listing that learns about a backup can say so without
  // resetting the editor around it.
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

  // Metadata only. Seeding the draft from the stored spec waits for the fetch below,
  // which cannot run until this has supplied the duration the spec is measured against.
  const handleLoadedMetadata = useCallback((video: HTMLVideoElement) => {
    const previousDuration = durationRef.current;
    setDuration(video.duration);
    setSourceWidth(video.videoWidth);
    setSourceHeight(video.videoHeight);

    // A `durationchange` that lands on the value already held is not a new source, and
    // treating it as one would wipe a draft the user is part way through.
    if (!hasUsableDuration(video.duration) || previousDuration === video.duration) return;

    setDraft(emptyDraft(video.duration));

    // Sticky mode remounts a fresh `<video autoPlay>` under an already-open panel;
    // pause so playback does not run behind the timeline. The in point is parked on
    // once the spec says where it is.
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

  // The draft, the shape the crop reads as and where the playhead sits all describe one
  // stored edit, so they are set together rather than left to find each other.
  const seedDraft = useCallback(
    (spec: VideoEditSpec | null, forDuration: number) => {
      const seeded = draftFromSpec(spec, forDuration);
      setDraft(seeded);
      setAspectId(aspectIdForCrop(seeded.crop, sourceRef.current));
      seekTo(seeded.trimStart);
    },
    [seekTo],
  );

  // One fetch per item, and not until the element has reported a duration: the stored
  // spec is in seconds, and seeding against a duration of NaN collapsed the timeline to
  // 0:00-0:00 until a second fetch happened to put it right. Keyed on the path rather
  // than the item, so a folder refresh - which hands back a new object for the same
  // file - cannot throw away a draft the user is in the middle of.
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
        // A missing spec is not worth a toast: the panel simply opens on an empty draft,
        // which is what an unedited file gets anyway.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMode, path, duration, seedDraft]);

  // Playback is clamped to the kept span rather than merely started there: dialling in
  // an out point is a lot of small adjustments, and each one should replay the result.
  // Re-run on the item as well as the mode. The `<video>` is keyed on both, so both
  // remount it - and a ref never re-runs an effect by itself, so navigating with the
  // mode sticky used to leave these listeners on a discarded element: the play icon
  // stopped answering and the trim loop stopped looping.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !editMode) return;

    // Read off the element rather than assumed: the listeners below report changes from
    // here on, and the element can already be playing by the time they attach.
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

  // The preview is honest about speed, and deliberately flattering about slow motion:
  // the browser plays every source frame at half rate, where `setpts` produces a file
  // with half the frames. Do not "fix" the preview to match without saying so.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = editMode ? draft.speed : 1;
  }, [draft.speed, editMode, videoRef]);

  // Only while editing. Everywhere else the element carries a `muted` attribute and the
  // native controls own the volume, and remounting per mode is what restores that.
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

  // Owned here rather than by the modal so that it resets with the item and is restored
  // with a stored spec, both of which are this hook's job. A chip left reading "1:1"
  // over the next video's untouched frame was the visible half of that.
  const selectAspect = useCallback((nextAspectId: string) => {
    setAspectId(nextAspectId);

    // Free only releases the lock: the rectangle the user has already shaped is theirs
    // to keep, and reshaping it to nothing in particular would be a strange thing to do
    // to it.
    const ratio = CROP_ASPECTS.find((aspect) => aspect.id === nextAspectId)?.ratio ?? null;
    if (ratio === null) return;

    // Picking a shape is asking to frame with it, so the handles come out with it.
    setCropActive(true);
    // Expressed in frame fractions, so the source's own aspect divides out first.
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
      // The guard reads a ref: a double click lands before `applying` has re-rendered
      // the button into its disabled form.
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
          // The mode stays on. Nothing about the surface needs to change: the editor was
          // already playing the original and the spec is expressed against it, so the
          // element is not even reloaded. `settle` records what is now on disk, which is
          // what makes Apply go quiet until something is changed again.
          if (mountedRef.current) settle();
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
    [notify],
  );

  const revert = useCallback(() => {
    runEdit(
      revertVideoEdit,
      (name) => `Restored the original ${name}.`,
      () => {
        // The file is the original again, so the spec that described the edit is no
        // longer true of anything.
        setSavedSpec(null);
        seedDraft(null, durationRef.current);
      },
    );
  }, [runEdit, seedDraft]);

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;
    const currentDuration = durationRef.current;

    // Dialling every value back to where it started asks for the file the backup already
    // holds, so restoring it is the honest way to grant that: a copy rather than a
    // re-encode, and the server refuses a spec that changes nothing in any case. Without
    // this, an edited clip could never be put back to 1x except by hunting for Revert.
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

  // Apply asks whether this differs from what is on disk, not from an untouched source:
  // the mode outlives an apply, so "already rendered exactly this" has to read as nothing
  // to do. An identity draft counts as a difference whenever something was written before
  // it - that is the request to have the original back, which `apply` routes to Revert.
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
