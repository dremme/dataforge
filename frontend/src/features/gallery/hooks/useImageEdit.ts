import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyImageEdit,
  fetchImageEditState,
  revertImageEdit,
} from "@/features/gallery/api/imageEdit";
import {
  aspectIdForCrop,
  cropForAspect,
  CROP_ASPECTS,
  type CropRect,
  type Orientation,
} from "@/features/gallery/lib/crop";
import {
  draftFromSpec,
  emptyDraft,
  isIdentityEdit,
  orientationOf,
  outputDimensions,
  rotateBy,
  specsEqual,
  toImageEditSpec,
  type ImageEditDraft,
} from "@/features/gallery/lib/imageEdit";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem, ImageEditSpec } from "@/shared/types";

export interface UseImageEditOptions {
  item: GalleryItem | undefined;
  /** Runs once the new file is on disk, so the owner can reload the folder. */
  onEdited?: () => void | Promise<void>;
  /**
   * Owned by the modal so the mode sticks across next/prev, exactly as the video
   * editor's does. This hook only drives enter/exit and reads the flag for its UI.
   */
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
}

export interface ImageEdit {
  editMode: boolean;
  /** The image has decoded, so the crop has a real frame and the readout real numbers. */
  ready: boolean;
  applying: boolean;
  draft: ImageEditDraft;
  sourceWidth: number;
  sourceHeight: number;
  hasBackup: boolean;
  dirty: boolean;
  cropActive: boolean;
  /** Which of `CROP_ASPECTS` the crop is locked to; "free" for none. */
  aspectId: string;
  /** That lock's width over height, or null. The overlay's handles honour it. */
  aspectRatio: number | null;
  /** How the preview is turned, for the stage's transform and the overlay's drags. */
  orientation: Orientation;
  outputWidth: number;
  outputHeight: number;
  toggleEditMode: () => void;
  exitEditMode: () => void;
  setCrop: (crop: CropRect) => void;
  setCropActive: (active: boolean) => void;
  selectAspect: (aspectId: string) => void;
  rotateClockwise: () => void;
  rotateCounterClockwise: () => void;
  toggleMirrorH: () => void;
  toggleMirrorV: () => void;
  setScale: (scale: number) => void;
  resetDraft: () => void;
  apply: () => void;
  revert: () => void;
  handleLoad: (image: HTMLImageElement) => void;
}

/**
 * Editing mode for the gallery's image viewer: describe the whole edit, then render it
 * from the untouched original in one pass.
 *
 * The draft is expressed against that original, never against the last render, which is
 * why the modal shows the original while this is on. Re-opening on an edited file seeds
 * the draft from the spec stored beside it, so changing one value keeps the rest.
 *
 * This is `useVideoEdit` with the time axis taken out. What is missing is missing for a
 * reason: a Pillow pass has no progress worth a bar and nothing worth cancelling, and a
 * still has no duration to wait for before the stored spec can be seeded.
 */
export function useImageEdit(options: UseImageEditOptions): ImageEdit {
  const notify = useNotify();
  const { item, editMode, setEditMode } = options;

  // Read through a ref so every returned callback is dependency-free, and so an apply
  // that outlives an item swap still finishes against the values it started with.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const applyingRef = useRef(false);

  const [sourceWidth, setSourceWidth] = useState(0);
  const [sourceHeight, setSourceHeight] = useState(0);
  const [draft, setDraft] = useState<ImageEditDraft>(emptyDraft);
  // What is on disk, as a spec rather than a draft. Kept apart from the draft for the
  // same reason the video editor does: `dirty` asks how they differ, and one of them has
  // to survive a re-seed the other does not.
  const [savedSpec, setSavedSpec] = useState<ImageEditSpec | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [aspectId, setAspectId] = useState("free");
  const [applying, setApplying] = useState(false);
  const [cropActive, setCropActive] = useState(false);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedSpecRef = useRef(savedSpec);
  savedSpecRef.current = savedSpec;
  const sourceRef = useRef({ width: sourceWidth, height: sourceHeight });
  sourceRef.current = { width: sourceWidth, height: sourceHeight };

  const path = item?.path;
  const ready = sourceWidth > 0 && sourceHeight > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keyed on the path alone. `has_backup` must stay out of it: an apply flips that field
  // when the folder reloads, and the `<img>` is not reloaded with it - it was already
  // showing the original - so nothing would fire `load` a second time to put back the
  // frame size this clears.
  //
  // `applying` is deliberately absent for a different reason: a render in flight against
  // the previous item must run its own `finally`, and clearing the flag here would race
  // it. `cropActive` is deliberately absent because it is the crop tool being selected,
  // and the tool outlives the item exactly as the mode does.
  useEffect(() => {
    setSourceWidth(0);
    setSourceHeight(0);
    setDraft(emptyDraft());
    setSavedSpec(null);
    setAspectId("free");
  }, [path]);

  // Seeded separately so a listing that learns about a backup can say so without
  // resetting the editor around it.
  useEffect(() => {
    setHasBackup(item?.has_backup ?? false);
  }, [item?.path, item?.has_backup]);

  const handleLoad = useCallback((image: HTMLImageElement) => {
    setSourceWidth(image.naturalWidth);
    setSourceHeight(image.naturalHeight);
  }, []);

  // The draft and the shape the crop reads as describe one stored edit, so they are set
  // together rather than left to find each other.
  const seedDraft = useCallback((spec: ImageEditSpec | null) => {
    const seeded = draftFromSpec(spec);
    setDraft(seeded);
    setAspectId(aspectIdForCrop(seeded.crop, sourceRef.current));
  }, []);

  // One fetch per item, and not until the element has reported a size. Nothing in the
  // spec is measured in the source's units, but the shape a stored crop is *read* as is:
  // seeding against a frame of 0x0 makes `aspectIdForCrop` answer "free", and the chip
  // then sits on Free over a rectangle that is locked to something. Keyed on the path
  // rather than the item, so a folder refresh - which hands back a new object for the
  // same file - cannot throw away a draft the user is in the middle of.
  useEffect(() => {
    if (!editMode || !path || !ready) return;

    let cancelled = false;
    void (async () => {
      try {
        const state = await fetchImageEditState(path);
        if (cancelled || !mountedRef.current) return;
        setHasBackup(state.has_backup);
        setSavedSpec(state.spec ?? null);
        seedDraft(state.spec ?? null);
      } catch {
        // A missing spec is not worth a toast: the panel simply opens on an empty draft,
        // which is what an unedited file gets anyway.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMode, path, ready, seedDraft]);

  const setCrop = useCallback((crop: CropRect) => {
    setDraft((current) => ({ ...current, crop }));
  }, []);

  // Owned here rather than by the modal so that it resets with the item and is restored
  // with a stored spec, both of which are this hook's job.
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

  const turn = useCallback((turns: number) => {
    setDraft((current) => ({ ...current, rotate: rotateBy(current.rotate, turns) }));
  }, []);

  const rotateClockwise = useCallback(() => turn(1), [turn]);
  const rotateCounterClockwise = useCallback(() => turn(-1), [turn]);

  const toggleMirrorH = useCallback(() => {
    setDraft((current) => ({ ...current, mirrorH: !current.mirrorH }));
  }, []);

  const toggleMirrorV = useCallback(() => {
    setDraft((current) => ({ ...current, mirrorV: !current.mirrorV }));
  }, []);

  const setScale = useCallback((scale: number) => {
    setDraft((current) => ({ ...current, scale }));
  }, []);

  const resetDraft = useCallback(() => {
    seedDraft(savedSpecRef.current);
  }, [seedDraft]);

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
    setEditMode(true);
  }, [editMode, exitEditMode, setEditMode]);

  const runEdit = useCallback(
    (
      request: (path: string) => Promise<{ has_backup: boolean }>,
      describe: (name: string) => string,
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

      void (async () => {
        try {
          const result = await request(mediaPath);
          if (mountedRef.current) setHasBackup(result.has_backup);
          notify({ variant: "success", message: describe(name) });
          await onEdited?.();
          // The mode stays on. Nothing about the surface needs to change: the editor was
          // already showing the original and the spec is expressed against it, so the
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
          if (mountedRef.current) setApplying(false);
        }
      })();
    },
    [notify],
  );

  const revert = useCallback(() => {
    runEdit(
      revertImageEdit,
      (name) => `Restored the original ${name}.`,
      () => {
        // The file is the original again, so the spec that described the edit is no
        // longer true of anything.
        setSavedSpec(null);
        seedDraft(null);
      },
    );
  }, [runEdit, seedDraft]);

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;

    // Dialling every value back to where it started asks for the file the backup already
    // holds, so restoring it is the honest way to grant that: a copy rather than a
    // re-encode, and the server refuses a spec that changes nothing in any case. Without
    // this, an edited image could never be put back upright except by hunting for Revert.
    if (isIdentityEdit(currentDraft)) {
      revert();
      return;
    }

    const spec = toImageEditSpec(currentDraft);
    const size = outputDimensions(
      sourceRef.current,
      currentDraft.crop,
      currentDraft.rotate,
      currentDraft.scale,
    );

    runEdit(
      (mediaPath) => applyImageEdit(mediaPath, spec),
      (name) => `Edited ${name} - ${size.width} x ${size.height}.`,
      () => setSavedSpec(spec),
    );
  }, [revert, runEdit]);

  // Apply asks whether this differs from what is on disk, not from an untouched source:
  // the mode outlives an apply, so "already rendered exactly this" has to read as nothing
  // to do. An identity draft counts as a difference whenever something was written before
  // it - that is the request to have the original back, which `apply` routes to Revert.
  const dirty =
    ready &&
    (savedSpec === null ? !isIdentityEdit(draft) : !specsEqual(toImageEditSpec(draft), savedSpec));

  const output = outputDimensions(
    { width: sourceWidth, height: sourceHeight },
    draft.crop,
    draft.rotate,
    draft.scale,
  );

  return {
    editMode,
    ready,
    applying,
    draft,
    sourceWidth,
    sourceHeight,
    hasBackup,
    dirty,
    cropActive,
    aspectId,
    aspectRatio: CROP_ASPECTS.find((aspect) => aspect.id === aspectId)?.ratio ?? null,
    orientation: orientationOf(draft),
    outputWidth: output.width,
    outputHeight: output.height,
    toggleEditMode,
    exitEditMode,
    setCrop,
    setCropActive,
    selectAspect,
    rotateClockwise,
    rotateCounterClockwise,
    toggleMirrorH,
    toggleMirrorV,
    setScale,
    resetDraft,
    apply,
    revert,
    handleLoad,
  };
}
