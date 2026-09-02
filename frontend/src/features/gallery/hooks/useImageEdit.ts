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
import { useMaskRegions, type MaskRegionControls } from "@/features/gallery/hooks/useMaskRegions";
import type { MaskDraft } from "@/features/gallery/lib/mask";
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
  onEdited?: () => void | Promise<void>;
  /** Owned by the modal so the mode sticks across next/prev. */
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
}

export interface ImageEdit extends MaskRegionControls {
  editMode: boolean;
  ready: boolean;
  applying: boolean;
  draft: ImageEditDraft;
  sourceWidth: number;
  sourceHeight: number;
  hasBackup: boolean;
  dirty: boolean;
  cropActive: boolean;
  aspectId: string;
  aspectRatio: number | null;
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
  setBrightness: (value: number) => void;
  setContrast: (value: number) => void;
  setSaturation: (value: number) => void;
  setWarmth: (value: number) => void;
  setHue: (value: number) => void;
  resetColor: () => void;
  resetDraft: () => void;
  apply: () => void;
  revert: () => void;
  handleLoad: (image: HTMLImageElement) => void;
}

export function useImageEdit(options: UseImageEditOptions): ImageEdit {
  const notify = useNotify();
  const { item, editMode, setEditMode } = options;

  // Ref so callbacks stay dependency-free; an apply outliving a swap keeps its starting values.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const applyingRef = useRef(false);

  const [sourceWidth, setSourceWidth] = useState(0);
  const [sourceHeight, setSourceHeight] = useState(0);
  const [draft, setDraft] = useState<ImageEditDraft>(emptyDraft);
  // On-disk spec, kept apart so dirty can compare and one can survive a re-seed alone.
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

  const setMasks = useCallback((update: (current: MaskDraft[]) => MaskDraft[]) => {
    setDraft((current) => ({ ...current, masks: update(current.masks) }));
  }, []);

  const {
    clearSelection: clearMaskSelection,
    deactivate: deactivateMasks,
    ...maskControls
  } = useMaskRegions(draft.masks, setMasks);

  const path = item?.path;
  const ready = sourceWidth > 0 && sourceHeight > 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keyed on path alone: has_backup would clear the frame size on apply (load never re-fires),
  // and applying/cropActive must stay out or they race the previous item / drop handles on next/prev.
  useEffect(() => {
    setSourceWidth(0);
    setSourceHeight(0);
    setDraft(emptyDraft());
    setSavedSpec(null);
    setAspectId("free");
    clearMaskSelection();
  }, [path, clearMaskSelection]);

  // Separate so a listing that learns about a backup does not reset the editor.
  useEffect(() => {
    setHasBackup(item?.has_backup ?? false);
  }, [item?.path, item?.has_backup]);

  const handleLoad = useCallback((image: HTMLImageElement) => {
    setSourceWidth(image.naturalWidth);
    setSourceHeight(image.naturalHeight);
  }, []);

  const seedDraft = useCallback(
    (spec: ImageEditSpec | null) => {
      const seeded = draftFromSpec(spec);
      setDraft(seeded);
      setAspectId(aspectIdForCrop(seeded.crop, sourceRef.current));
      clearMaskSelection();
    },
    [clearMaskSelection],
  );

  // Wait for a real size: seeding 0x0 makes aspectIdForCrop answer "free" over a locked rect.
  // Keyed on path, not the item object, so a folder refresh cannot throw away a draft in progress.
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
        // Missing spec: open on an empty draft like an unedited file.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editMode, path, ready, seedDraft]);

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

  const setBrightness = useCallback((brightness: number) => {
    setDraft((current) => ({ ...current, brightness }));
  }, []);

  const setContrast = useCallback((contrast: number) => {
    setDraft((current) => ({ ...current, contrast }));
  }, []);

  const setSaturation = useCallback((saturation: number) => {
    setDraft((current) => ({ ...current, saturation }));
  }, []);

  const setWarmth = useCallback((warmth: number) => {
    setDraft((current) => ({ ...current, warmth }));
  }, []);

  const setHue = useCallback((hue: number) => {
    setDraft((current) => ({ ...current, hue }));
  }, []);

  const resetColor = useCallback(() => {
    setDraft((current) => ({
      ...current,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      warmth: 0,
      hue: 0,
    }));
  }, []);

  const resetDraft = useCallback(() => {
    seedDraft(savedSpecRef.current);
  }, [seedDraft]);

  const exitEditMode = useCallback(() => {
    setCropActive(false);
    deactivateMasks();
    setEditMode(false);
  }, [deactivateMasks, setEditMode]);

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
      // Ref guard: a double click lands before applying has re-rendered the button disabled.
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
        setSavedSpec(null);
        seedDraft(null);
      },
    );
  }, [runEdit, seedDraft]);

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;

    // Identity draft restores the backup instead of re-encoding; else only Revert returns upright.
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

  // Dirty vs disk, not an untouched source: an identity draft after a write means Revert.
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
    ...maskControls,
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
    setBrightness,
    setContrast,
    setSaturation,
    setWarmth,
    setHue,
    resetColor,
    resetDraft,
    apply,
    revert,
    handleLoad,
  };
}
