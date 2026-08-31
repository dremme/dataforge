import { useCallback, useRef, useState } from "react";
import type { CropRect } from "@/features/gallery/lib/crop";
import {
  DEFAULT_MASK_MODE,
  DEFAULT_MASK_STRENGTH,
  MAX_MASK_REGIONS,
  newMaskDraft,
  type MaskDraft,
  type MaskMode,
} from "@/features/gallery/lib/mask";

/** The blur tool's half of an editor, shared so the picture and the video behave alike. */
export interface MaskRegionControls {
  maskActive: boolean;
  selectedMaskId: string | null;
  selectedMask: MaskDraft | null;
  maskMode: MaskMode;
  maskStrength: number;
  maskLimitReached: boolean;
  setMaskActive: (active: boolean) => void;
  selectMask: (maskId: string | null) => void;
  addMask: () => void;
  setMaskRect: (maskId: string, rect: CropRect) => void;
  setMaskMode: (mode: MaskMode) => void;
  setMaskStrength: (strength: number) => void;
  removeMask: (maskId: string) => void;
  clearMasks: () => void;
}

export interface MaskRegions extends MaskRegionControls {
  /** For the item swap and the re-seed, which drop the selection but keep the tool armed. */
  clearSelection: () => void;
  /** For leaving edit mode, which stows the gizmo as well. */
  deactivate: () => void;
}

export function useMaskRegions(
  masks: readonly MaskDraft[],
  setMasks: (update: (current: MaskDraft[]) => MaskDraft[]) => void,
): MaskRegions {
  const [maskActive, setMaskActive] = useState(false);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  // Kept apart from the selection so the controls still say what the next region will be.
  const [maskDefaults, setMaskDefaults] = useState({
    mode: DEFAULT_MASK_MODE,
    strength: DEFAULT_MASK_STRENGTH,
  });

  const masksRef = useRef(masks);
  masksRef.current = masks;
  const selectedMaskRef = useRef(selectedMaskId);
  selectedMaskRef.current = selectedMaskId;
  const defaultsRef = useRef(maskDefaults);
  defaultsRef.current = maskDefaults;

  const selectMask = useCallback((maskId: string | null) => {
    setSelectedMaskId(maskId);
  }, []);

  const addMask = useCallback(() => {
    const placed = masksRef.current.length;
    if (placed >= MAX_MASK_REGIONS) return;

    const { mode, strength } = defaultsRef.current;
    const mask = newMaskDraft(mode, strength, placed);

    setMasks((current) => [...current, mask]);
    setSelectedMaskId(mask.id);
  }, [setMasks]);

  const setMaskRect = useCallback(
    (maskId: string, rect: CropRect) => {
      setMasks((current) => current.map((mask) => (mask.id === maskId ? { ...mask, rect } : mask)));
    },
    [setMasks],
  );

  // The controls edit the selection and set what the next region will be, so both move together.
  const applyToSelection = useCallback(
    (patch: Partial<Pick<MaskDraft, "mode" | "strength">>) => {
      setMasks((current) =>
        current.map((mask) => (mask.id === selectedMaskRef.current ? { ...mask, ...patch } : mask)),
      );
    },
    [setMasks],
  );

  const setMaskMode = useCallback(
    (mode: MaskMode) => {
      setMaskDefaults((current) => ({ ...current, mode }));
      applyToSelection({ mode });
    },
    [applyToSelection],
  );

  const setMaskStrength = useCallback(
    (strength: number) => {
      setMaskDefaults((current) => ({ ...current, strength }));
      applyToSelection({ strength });
    },
    [applyToSelection],
  );

  const removeMask = useCallback(
    (maskId: string) => {
      setMasks((current) => current.filter((mask) => mask.id !== maskId));
      setSelectedMaskId((current) => (current === maskId ? null : current));
    },
    [setMasks],
  );

  const clearMasks = useCallback(() => {
    setMasks(() => []);
    setSelectedMaskId(null);
  }, [setMasks]);

  const clearSelection = useCallback(() => {
    setSelectedMaskId(null);
  }, []);

  const deactivate = useCallback(() => {
    setMaskActive(false);
    setSelectedMaskId(null);
  }, []);

  const selectedMask = masks.find((mask) => mask.id === selectedMaskId) ?? null;

  return {
    maskActive,
    selectedMaskId,
    selectedMask,
    maskMode: selectedMask?.mode ?? maskDefaults.mode,
    maskStrength: selectedMask?.strength ?? maskDefaults.strength,
    maskLimitReached: masks.length >= MAX_MASK_REGIONS,
    setMaskActive,
    selectMask,
    addMask,
    setMaskRect,
    setMaskMode,
    setMaskStrength,
    removeMask,
    clearMasks,
    clearSelection,
    deactivate,
  };
}
