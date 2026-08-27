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

const NEIGHBOUR_WARM_DELAY_MS = 120;
const NEIGHBOUR_WARM_OFFSETS = [-2, -1, 1, 2] as const;

export interface UseGifFrameCaptureOptions {
  item: GalleryItem | undefined;
  frameCount: number | undefined;
  folderPath: string | undefined;
  onSaved?: () => void | Promise<void>;
  /** Owned by the modal so mode sticks across next/prev between videos and GIFs. */
  frameMode: boolean;
  setFrameMode: (frameMode: boolean) => void;
}

export interface GifFrameCapture extends FrameCapture {
  frameCount: number;
  frameIndex: number;
  /** Stage src in frame mode; undefined leaves the GIF animating. */
  previewUrl: string | undefined;
  setFrameIndex: (index: number) => void;
}

export function useGifFrameCapture(options: UseGifFrameCaptureOptions): GifFrameCapture {
  const notify = useNotify();
  const { item, frameCount, frameMode, setFrameMode } = options;

  // Ref so callbacks stay dependency-free; a save outliving a swap keeps its starting values.
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

  // >= 1 so a one-frame GIF is still savable; the slider goes inert at that size.
  const ready = resolvedCount >= 1;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Scrubber only; a save in flight against the previous item must run its own finally.
  useEffect(() => {
    setFrameIndexState(0);
  }, [item?.path]);

  const previewUrl =
    frameMode && item && ready ? galleryItemGifFrameUrl(item, frameIndex) : undefined;

  // Warm neighbours after the scrub settles; per-index would race the visible frame.
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
        // Drop the attribute rather than blanking it: empty src re-requests the page URL.
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
    // Ref guard: a double click lands before saving has re-rendered the button disabled.
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
