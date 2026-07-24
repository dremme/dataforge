import { useCallback, useMemo, useState } from "react";

export function useGallerySelection() {
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [syspromptOpen, setSyspromptOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const clearSelectedPaths = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionEpoch((epoch) => epoch + 1);
    setSyspromptOpen(false);
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

  const selectAllPaths = useCallback((paths: string[]) => {
    setSelectedPaths(new Set(paths));
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

  const selectedCount = selectedPaths.size;
  const hasSelection = selectedCount > 0;

  const selectedPathsList = useMemo(() => Array.from(selectedPaths), [selectedPaths]);

  const getJobPaths = useCallback((): string[] | undefined => {
    if (!selectionMode || !hasSelection) return undefined;
    return selectedPathsList;
  }, [hasSelection, selectedPathsList, selectionMode]);

  return {
    selectionEpoch,
    syspromptOpen,
    setSyspromptOpen,
    clearSelection,
    selectionMode,
    selectedPaths,
    selectedCount,
    hasSelection,
    selectedPathsList,
    getJobPaths,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    selectAllPaths,
    removeSelectedPaths,
    clearSelectedPaths,
  };
}
