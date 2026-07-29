import { createContext, useContext, useMemo, type ReactNode } from "react";

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
  toggleSelectedPath: (path: string) => void;
  clearSelectedPaths: () => void;
  selectAllPaths: () => void;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
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
    clearSelectedPaths,
    selectAllPaths,
    onDeleted,
    onMoved,
  } = value;

  const contextValue = useMemo<GallerySelectionValue>(
    () => ({
      selectionMode,
      selectedPaths,
      selectedCount,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelectedPath,
      clearSelectedPaths,
      selectAllPaths,
      onDeleted,
      onMoved,
    }),
    [
      selectionMode,
      selectedPaths,
      selectedCount,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelectedPath,
      clearSelectedPaths,
      selectAllPaths,
      onDeleted,
      onMoved,
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
