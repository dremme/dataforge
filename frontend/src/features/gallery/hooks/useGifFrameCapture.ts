import { useCallback, useEffect, useRef, useState } from "react";
import { importFiles } from "@/features/folder/api/files";
import type { FrameCapture } from "@/features/gallery/lib/frameCapture";
import { frameSaveOutcome } from "@/features/gallery/lib/frameCapture";
import {
  clampFrameIndex,
  gifFrameTargetName,
  stepFrameIndex,
} from "@/features/gallery/lib/gifFrameCapture";
import { galleryItemGifFrameUrl } from "@/features/gallery/lib/thumbnail";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

/** How long the scrub must sit still before neighbouring frames are warmed. */
const NEIGHBOUR_WARM_DELAY_MS = 120;

/** Warmed on either side of the shown frame, so a step or two lands instantly. */
const NEIGHBOUR_WARM_OFFSETS = [-2, -1, 1, 2] as const;

export interface UseGifFrameCaptureOptions {
  item: GalleryItem | undefined;
  /** Frame count from `useGifInfo`. Frame mode is not offered without it. */
  frameCount: number | undefined;
  /** Where the frame is written. Frame mode is not offered without it. */
  folderPath: string | undefined;
  /** Runs once the frame is on disk, so the owner can reload the folder. */
  onSaved?: () => void | Promise<void>;
  /**
   * Owned by the modal so mode can stick across next/prev between videos and
   * GIFs. This hook only drives enter/exit and reads the flag for UI.
   */
  frameMode: boolean;
  setFrameMode: (frameMode: boolean) => void;
}

export interface GifFrameCapture extends FrameCapture {
  frameCount: number;
  frameIndex: number;
  /** The stage's `src` while in frame mode; `undefined` leaves the GIF animating. */
  previewUrl: string | undefined;
  setFrameIndex: (index: number) => void;
}

/**
 * Frame-capture mode for the gallery's GIF viewer.
 *
 * The video path draws its own `<video>` element to a canvas so the saved file is
 * provably the frame on screen. An `<img>` cannot be seeked at all, so this asks
 * the server to decode instead — and then saves by re-reading the very URL the
 * preview painted. Because that URL is versioned and cached immutably, the save is
 * a cache hit on those exact bytes, which ties the file to the pixels at least as
 * tightly as the canvas route does.
 */
export function useGifFrameCapture(options: UseGifFrameCaptureOptions): GifFrameCapture {
  const notify = useNotify();
  const { item, frameCount, frameMode, setFrameMode } = options;

  // Read through a ref so every returned callback is dependency-free, and so a save
  // that outlives an item swap still finishes against the values it started with.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);

  const [frameIndex, setFrameIndexState] = useState(0);
  const [saving, setSaving] = useState(false);

  const savingRef = useRef(false);
  const frameIndexRef = useRef(frameIndex);
  frameIndexRef.current = frameIndex;

  const resolvedCount = frameCount ?? 0;
  const frameCountRef = useRef(resolvedCount);
  frameCountRef.current = resolvedCount;

  // A one-frame GIF is still worth saving, so this is `>= 1`. The slider goes
  // inert at that size while the save button stays live.
  const ready = resolvedCount >= 1;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Scrubber only. Frame mode is owned by the modal so next/prev can keep capture
  // on across items. `saving` is deliberately absent: a save in flight against the
  // previous item must run its own `finally`, and clearing the flag here would race it.
  useEffect(() => {
    setFrameIndexState(0);
  }, [item?.path]);

  const previewUrl =
    frameMode && item && ready ? galleryItemGifFrameUrl(item, frameIndex) : undefined;

  // Warm the frames around the one on screen so stepping does not wait on a
  // request. Deferred until the scrub settles rather than fired per index: a drag
  // crosses dozens of frames, and warming each one races the visible frame for
  // the handful of connections the browser allows per origin. Blanking `src` on
  // cleanup aborts any warm the next move has already made pointless.
  useEffect(() => {
    if (!frameMode || !item || !ready) return;

    const warmed: HTMLImageElement[] = [];
    const timer = window.setTimeout(() => {
      for (const offset of NEIGHBOUR_WARM_OFFSETS) {
        const neighbour = frameIndex + offset;
        if (neighbour < 0 || neighbour >= resolvedCount) continue;
        const image = new Image();
        image.src = galleryItemGifFrameUrl(item, neighbour);
        warmed.push(image);
      }
    }, NEIGHBOUR_WARM_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      for (const image of warmed) {
        // Dropping the attribute rather than blanking it: an empty `src` has a
        // legacy reading where the browser re-requests the page URL instead.
        image.removeAttribute("src");
      }
    };
  }, [frameIndex, frameMode, item, ready, resolvedCount]);

  const setFrameIndex = useCallback((index: number) => {
    setFrameIndexState(clampFrameIndex(index, frameCountRef.current));
  }, []);

  const stepFrame = useCallback((direction: -1 | 1) => {
    setFrameIndexState((current) => stepFrameIndex(current, direction, frameCountRef.current));
  }, []);

  const exitFrameMode = useCallback(() => {
    setFrameMode(false);
  }, [setFrameMode]);

  const toggleFrameMode = useCallback(() => {
    if (savingRef.current) return;
    setFrameMode(!frameMode);
  }, [frameMode, setFrameMode]);

  const saveFrame = useCallback(() => {
    // The re-entrancy guard reads a ref: a double click lands before `saving` state
    // has re-rendered the button into its disabled form.
    if (savingRef.current) return;

    const { item: currentItem, folderPath: destination, onSaved } = optionsRef.current;
    if (!currentItem || !destination || frameCountRef.current < 1) return;

    // Snapshotted so an item swap mid-upload cannot retarget the write.
    const sourcePath = currentItem.path;
    const targetIndex = clampFrameIndex(frameIndexRef.current, frameCountRef.current);
    const target = gifFrameTargetName(sourcePath, targetIndex);
    const frameUrl = galleryItemGifFrameUrl(currentItem, targetIndex);

    savingRef.current = true;
    setSaving(true);

    void (async () => {
      try {
        const response = await fetch(frameUrl);
        if (!response.ok) {
          throw new Error(`The server could not decode frame ${targetIndex + 1}.`);
        }
        const blob = await response.blob();
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
    frameMode,
    ready,
    frameCount: resolvedCount,
    frameIndex,
    previewUrl,
    saving,
    toggleFrameMode,
    exitFrameMode,
    setFrameIndex,
    stepFrame,
    saveFrame,
  };
}
