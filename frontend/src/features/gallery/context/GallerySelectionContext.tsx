import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { GallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";

/** GalleryCard must not subscribe: selectedPaths changes identity and re-renders the grid. */
export interface GallerySelectionValue {
  selectionMode: boolean;
  selectedPaths: ReadonlySet<string>;
  visibleSelectedPaths: ReadonlySet<string>;
  visibleSelectedCount: number;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleSelectedPath: (path: string) => void;
  extendSelectionTo: (path: string) => void;
  clearSelectedPaths: () => void;
  selectAllPaths: () => void;
  invertSelectedPaths: () => void;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
  onCopied: () => void | Promise<void>;
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
    visibleSelectedPaths,
    visibleSelectedCount,
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
      visibleSelectedPaths,
      visibleSelectedCount,
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
      visibleSelectedPaths,
      visibleSelectedCount,
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
