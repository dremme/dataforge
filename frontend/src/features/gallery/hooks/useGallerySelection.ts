import { useCallback, useMemo, useRef, useState } from "react";
import { pathRangeBetween } from "@/features/gallery/lib/selectionIntent";

export function useGallerySelection() {
  const [folderResetToken, setFolderResetToken] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set());

  // Last-clicked item for Shift+click. A ref, not state: context would re-render every card.
  const selectionAnchorRef = useRef<string | null>(null);

  const clearSelectedPaths = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectedPaths(new Set());
  }, []);

  // Folder navigation only. Filters keep hidden paths so widening restores them, inert till then.
  const clearSelection = useCallback(() => {
    setFolderResetToken((token) => token + 1);
    setSelectionMode(false);
    clearSelectedPaths();
  }, [clearSelectedPaths]);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    clearSelectedPaths();
  }, [clearSelectedPaths]);

  const toggleSelectedPath = useCallback((path: string) => {
    selectionAnchorRef.current = path;
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Additive range from the anchor. It does not move, so a second Shift+click starts there.
  const selectPathRange = useCallback((orderedPaths: readonly string[], path: string) => {
    const range = pathRangeBetween(orderedPaths, selectionAnchorRef.current, path);
    if (selectionAnchorRef.current === null) {
      selectionAnchorRef.current = path;
    }
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const item of range) {
        next.add(item);
      }
      return next;
    });
  }, []);

  // Union, not replace: select-all must not discard what a wider filter left selected out of view.
  const selectAllPaths = useCallback((paths: string[]) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const path of paths) {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Flip only the given paths; hidden membership stays so widening the filter restores it.
  const invertSelectedPaths = useCallback((paths: string[]) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (next.has(path)) next.delete(path);
        else next.add(path);
      }
      return next;
    });
  }, []);

  const removeSelectedPaths = useCallback((paths: readonly string[]) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const path of paths) {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const selectedPathsList = useMemo(() => Array.from(selectedPaths), [selectedPaths]);

  return {
    folderResetToken,
    clearSelection,
    selectionMode,
    selectedPaths,
    selectedPathsList,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    selectPathRange,
    selectAllPaths,
    invertSelectedPaths,
    removeSelectedPaths,
    clearSelectedPaths,
  };
}
