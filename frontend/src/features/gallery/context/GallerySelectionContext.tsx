import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { GallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";

/**
 * Multi-select state for the gallery grid.
 *
 * Lives in context because the owner (`useGallerySelection`, at the app root)
 * and the consumers (`Gallery`, `GallerySelectionControls`) sit four component
 * levels apart, with nothing in between needing the values.
 *
 * `GalleryCard` deliberately does NOT read this context: the grid is
 * virtualized, and a card that subscribed here would re-render on every toggle
 * because `selectedPaths` changes identity. `Gallery` reads the set once and
 * hands each card a plain `selected` boolean, which keeps `memo` effective.
 */
export interface GallerySelectionValue {
  selectionMode: boolean;
  selectedPaths: ReadonlySet<string>;
  selectedCount: number;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  /** Ctrl/Cmd+click, and a plain click in selection mode: enters the mode, then toggles. */
  toggleSelectedPath: (path: string) => void;
  /** Shift+click: enters the mode, then adds the run from the last-clicked item to this one. */
  extendSelectionTo: (path: string) => void;
  clearSelectedPaths: () => void;
  selectAllPaths: () => void;
  invertSelectedPaths: () => void;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
  /** Takes no paths: a copy leaves this folder's items exactly where they were. */
  onCopied: () => void | Promise<void>;
  /**
   * Delete / move / copy for the selection. Owned at the workspace level so the
   * quick action bar drives the same flows these buttons do; already memoised by
   * its hook, so it costs this context one dependency rather than a dozen.
   */
  actions: GallerySelectionActions;
}

const GallerySelectionContext = createContext<GallerySelectionValue | null>(null);

export function GallerySelectionProvider({
  children,
  ...value
}: GallerySelectionValue & { children: ReactNode }) {
  const {
    selectionMode,
    selectedPaths,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    extendSelectionTo,
    clearSelectedPaths,
    selectAllPaths,
    invertSelectedPaths,
    onDeleted,
    onMoved,
    onCopied,
    actions,
  } = value;

  const contextValue = useMemo<GallerySelectionValue>(
    () => ({
      selectionMode,
      selectedPaths,
      selectedCount,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelectedPath,
      extendSelectionTo,
      clearSelectedPaths,
      selectAllPaths,
      invertSelectedPaths,
      onDeleted,
      onMoved,
      onCopied,
      actions,
    }),
    [
      selectionMode,
      selectedPaths,
      selectedCount,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelectedPath,
      extendSelectionTo,
      clearSelectedPaths,
      selectAllPaths,
      invertSelectedPaths,
      onDeleted,
      onMoved,
      onCopied,
      actions,
    ],
  );

  return (
    <GallerySelectionContext.Provider value={contextValue}>
      {children}
    </GallerySelectionContext.Provider>
  );
}

export function useGallerySelectionContext(): GallerySelectionValue {
  const context = useContext(GallerySelectionContext);
  if (!context) {
    throw new Error("useGallerySelectionContext must be used within GallerySelectionProvider");
  }
  return context;
}
