import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { importFiles } from "@/features/browse/api/files";
import {
  JPEG_QUALITY,
  clampFrameTime,
  frameSaveOutcome,
  hasUsableDuration,
  snapFrameTime,
  stepFrameTime,
  videoFrameTargetName,
} from "@/features/gallery/lib/videoFrameCapture";
import { encodeVideoFrame, seekVideoTo } from "@/features/gallery/lib/videoFrameEncode";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

export interface UseVideoFrameCaptureOptions {
  item: GalleryItem | undefined;
  /** Where the frame is written. Frame mode is not offered without it. */
  folderPath: string | undefined;
  /** Runs once the frame is on disk, so the owner can reload the folder. */
  onSaved?: () => void | Promise<void>;
}

export interface VideoFrameCapture {
  videoRef: RefObject<HTMLVideoElement | null>;
  frameMode: boolean;
  /** Metadata has landed and the duration can drive the slider. */
  ready: boolean;
  duration: number;
  /** Controlled value of the range input. */
  sliderTime: number;
  /** The presented frame's time where known, otherwise `sliderTime`. Drives the readout. */
  displayTime: number;
  saving: boolean;
  toggleFrameMode: () => void;
  exitFrameMode: () => void;
  setSliderTime: (time: number) => void;
  stepFrame: (direction: -1 | 1) => void;
  /** Wire to the video's `onLoadedMetadata` and `onDurationChange` alike. */
  handleLoadedMetadata: (video: HTMLVideoElement) => void;
  saveFrame: () => void;
}

/**
 * Frame-capture mode for the gallery's video viewer: scrub the element itself as
 * the preview, then write the shown frame to a sibling JPG.
 *
 * The encode is client-side on purpose. Drawing the very element the user is
 * looking at is the only way to guarantee the saved file is the frame they picked;
 * a server-side seek to the same timestamp can land on a different frame.
 */
export function useVideoFrameCapture(options: UseVideoFrameCaptureOptions): VideoFrameCapture {
  const notify = useNotify();
  const { item } = options;

  // Read through a ref so every returned callback is dependency-free, and so a save
  // that outlives an item swap still finishes against the values it started with.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mountedRef = useRef(true);

  const [frameMode, setFrameMode] = useState(false);
  const [duration, setDuration] = useState(Number.NaN);
  const [sliderTime, setSliderTimeState] = useState(0);
  /**
   * Where the decoder says it actually landed. Kept apart from `sliderTime` so it
   * never fights the controlled input mid-drag: the slider stays authoritative for
   * the element, and this only ever feeds the readout.
   */
  const [presentedTime, setPresentedTime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const savingRef = useRef(false);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const sliderTimeRef = useRef(sliderTime);
  sliderTimeRef.current = sliderTime;

  const ready = hasUsableDuration(duration);
  const displayTime = presentedTime ?? sliderTime;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `saving` is deliberately absent: a save in flight against the previous item must
  // run its own `finally`, and clearing the flag here would race it. Frame mode goes
  // off regardless, so the bar unmounts and nothing user-visible is left stuck.
  useEffect(() => {
    setFrameMode(false);
    setDuration(Number.NaN);
    setSliderTimeState(0);
    setPresentedTime(null);
  }, [item?.path]);

  const setSliderTime = useCallback((time: number) => {
    const next = clampFrameTime(time, durationRef.current);
    setSliderTimeState(next);
    // Let the readout track the drag; the seek settles it back onto a real frame.
    setPresentedTime(null);

    // Written straight through with no debounce: the element is the preview, and
    // coalescing rapid seeks is the browser's job.
    const video = videoRef.current;
    if (video) {
      video.currentTime = next;
    }
  }, []);

  const stepFrame = useCallback(
    (direction: -1 | 1) => {
      // Stepping starts from the frame on screen, not from the last slider write.
      setSliderTime(stepFrameTime(displayTime, direction, durationRef.current));
    },
    [displayTime, setSliderTime],
  );

  const handleLoadedMetadata = useCallback((video: HTMLVideoElement) => {
    setDuration(video.duration);
  }, []);

  const enterFrameMode = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      // Seed from the playhead: the toggle was pressed because *this* is the frame.
      const seeded = snapFrameTime(clampFrameTime(video.currentTime, durationRef.current));
      setSliderTimeState(seeded);
      setPresentedTime(video.currentTime);
    }
    setFrameMode(true);
  }, []);

  // Nothing is restored on the way out. The playhead stays where it was dragged
  // (scrubbers behave that way) and playback stays paused rather than snapping back
  // to motion over a frame the user just spent effort finding. Native controls come
  // back with the mode, so resuming is one click away.
  const exitFrameMode = useCallback(() => {
    setFrameMode(false);
  }, []);

  const toggleFrameMode = useCallback(() => {
    if (savingRef.current) return;
    if (frameMode) {
      exitFrameMode();
      return;
    }
    enterFrameMode();
  }, [enterFrameMode, exitFrameMode, frameMode]);

  const saveFrame = useCallback(() => {
    // The re-entrancy guard reads a ref: a double click lands before `saving` state
    // has re-rendered the button into its disabled form.
    if (savingRef.current) return;

    const video = videoRef.current;
    const { item: currentItem, folderPath: destination, onSaved } = optionsRef.current;
    if (!video || !currentItem || !destination) return;

    // Snapshotted so an item swap mid-upload cannot retarget the write.
    const sourcePath = currentItem.path;
    const targetTime = clampFrameTime(sliderTimeRef.current, durationRef.current);
    // Named from the requested time up front so a failure before the seek still has
    // a filename to report; the presented frame's own time replaces it below.
    let target = videoFrameTargetName(sourcePath, targetTime);

    savingRef.current = true;
    setSaving(true);

    void (async () => {
      try {
        video.pause();
        const presented = await seekVideoTo(video, targetTime);
        if (mountedRef.current) setPresentedTime(presented);
        // The decoder's own timestamp for the frame it showed, so scrubbing anywhere
        // inside one frame keeps naming that frame's file.
        target = videoFrameTargetName(sourcePath, presented);

        const blob = await encodeVideoFrame(video, JPEG_QUALITY);
        const file = new File([blob], target, { type: "image/jpeg" });
        // Overwrite still applies, but now only when the same frame is saved twice:
        // distinct frames get distinct names, so earlier saves stay put.
        const result = await importFiles(destination, [file], true);

        const outcome = frameSaveOutcome(result, target);
        notify(outcome);
        if (outcome.variant === "success") {
          await onSaved?.();
        }
      } catch (error) {
        // Unguarded by `mountedRef`: the notification store outlives this modal, so
        // a save that finishes after a close still reports.
        notify({
          variant: "danger",
          message: `Could not save ${target}: ${formatApiError(error)}`,
        });
      } finally {
        savingRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    })();
  }, [notify]);

  return {
    videoRef,
    frameMode,
    ready,
    duration,
    sliderTime,
    displayTime,
    saving,
    toggleFrameMode,
    exitFrameMode,
    setSliderTime,
    stepFrame,
    handleLoadedMetadata,
    saveFrame,
  };
}
