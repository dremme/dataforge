import { useCallback, useMemo, useState } from "react";

export function useGallerySelection() {
  const [folderResetToken, setFolderResetToken] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set());

  const clearSelectedPaths = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  /**
   * Drop everything tied to the folder being left: the selection, and — via the
   * token — any overlay still showing one of its items.
   *
   * Only folder navigation calls this. Narrowing the view (search, sort, filters)
   * deliberately does not: a path stays selected while it is filtered out, so
   * refining a search does not silently shrink what the next action will touch.
   */
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

  /**
   * Flip membership of the given paths, leaving anything outside that set as it
   * is — a path that is selected but filtered out of the current view stays
   * selected, the same way narrowing a search does not shrink the selection.
   */
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

  const selectedCount = selectedPaths.size;
  const hasSelection = selectedCount > 0;

  const selectedPathsList = useMemo(() => Array.from(selectedPaths), [selectedPaths]);

  const getJobPaths = useCallback((): string[] | undefined => {
    if (!selectionMode || !hasSelection) return undefined;
    return selectedPathsList;
  }, [hasSelection, selectedPathsList, selectionMode]);

  return {
    folderResetToken,
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
    invertSelectedPaths,
    removeSelectedPaths,
    clearSelectedPaths,
  };
}
