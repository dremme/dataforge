import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { importFiles } from "@/features/folder/api/files";
import type { FrameCapture } from "@/features/gallery/lib/frameCapture";
import { JPEG_QUALITY, frameSaveOutcome } from "@/features/gallery/lib/frameCapture";
import {
  clampFrameTime,
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
  folderPath: string | undefined;
  onSaved?: () => void | Promise<void>;
  /** Owned by the modal so mode sticks across next/prev between videos and GIFs. */
  frameMode: boolean;
  setFrameMode: (frameMode: boolean) => void;
}

export interface VideoFrameCapture extends FrameCapture {
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  sliderTime: number;
  /** Presented frame time where known, otherwise sliderTime. */
  displayTime: number;
  setSliderTime: (time: number) => void;
  handleLoadedMetadata: (video: HTMLVideoElement) => void;
}

/** Client-side encode: a server seek to the same timestamp can land on a different frame. */
export function useVideoFrameCapture(options: UseVideoFrameCaptureOptions): VideoFrameCapture {
  const notify = useNotify();
  const { item, frameMode, setFrameMode } = options;

  // Ref so callbacks stay dependency-free; a save outliving a swap keeps its starting values.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mountedRef = useRef(true);

  const [duration, setDuration] = useState(Number.NaN);
  const [sliderTime, setSliderTimeState] = useState(0);
  // Decoder landing; kept apart from sliderTime so it never fights the controlled input mid-drag.
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

  // Scrubber only; a save in flight against the previous item must run its own finally.
  useEffect(() => {
    setDuration(Number.NaN);
    setSliderTimeState(0);
    setPresentedTime(null);
  }, [item?.path]);

  const setSliderTime = useCallback((time: number) => {
    const next = clampFrameTime(time, durationRef.current);
    setSliderTimeState(next);
    setPresentedTime(null);

    const video = videoRef.current;
    if (video) {
      video.currentTime = next;
    }
  }, []);

  const stepFrame = useCallback(
    (direction: -1 | 1) => {
      setSliderTime(stepFrameTime(displayTime, direction, durationRef.current));
    },
    [displayTime, setSliderTime],
  );

  const seedFromVideo = useCallback((video: HTMLVideoElement) => {
    video.pause();
    const seeded = snapFrameTime(clampFrameTime(video.currentTime, video.duration));
    setSliderTimeState(seeded);
    setPresentedTime(video.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(
    (video: HTMLVideoElement) => {
      setDuration(video.duration);
      // Sticky capture remounts a new <video autoPlay>; pause and seed so playback stays off.
      if (optionsRef.current.frameMode) {
        seedFromVideo(video);
      }
    },
    [seedFromVideo],
  );

  const enterFrameMode = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      seedFromVideo(video);
    }
    setFrameMode(true);
  }, [seedFromVideo, setFrameMode]);

  const exitFrameMode = useCallback(() => {
    setFrameMode(false);
  }, [setFrameMode]);

  const toggleFrameMode = useCallback(() => {
    if (savingRef.current) return;
    if (frameMode) {
      exitFrameMode();
      return;
    }
    enterFrameMode();
  }, [enterFrameMode, exitFrameMode, frameMode]);

  const saveFrame = useCallback(() => {
    // Ref guard: a double click lands before saving has re-rendered the button disabled.
    if (savingRef.current) return;

    const video = videoRef.current;
    const { item: currentItem, folderPath: destination, onSaved } = optionsRef.current;
    if (!video || !currentItem || !destination) return;

    // Snapshotted so an item swap mid-upload cannot retarget the write.
    const sourcePath = currentItem.path;
    const targetTime = clampFrameTime(sliderTimeRef.current, durationRef.current);
    // Named from the requested time so a failure before the seek still has a filename.
    let target = videoFrameTargetName(sourcePath, targetTime);

    savingRef.current = true;
    setSaving(true);

    void (async () => {
      try {
        video.pause();
        const presented = await seekVideoTo(video, targetTime);
        if (mountedRef.current) setPresentedTime(presented);
        target = videoFrameTargetName(sourcePath, presented);

        const blob = await encodeVideoFrame(video, JPEG_QUALITY);
        const file = new File([blob], target, { type: "image/jpeg" });
        const result = await importFiles(destination, [file], true);

        const outcome = frameSaveOutcome(result, target);
        notify(outcome);
        if (outcome.variant === "success") {
          await onSaved?.();
        }
      } catch (error) {
        // Unguarded by mountedRef: the store outlives this modal, so a finish after close reports.
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
