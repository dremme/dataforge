import type { ReactNode } from "react";
import {
  GallerySelectionProvider,
  type GallerySelectionValue,
} from "@/features/gallery/context/GallerySelectionContext";
import { SelectionActionOverlays } from "@/features/gallery/components/SelectionActionOverlays";
import { useGallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";

interface GallerySelectionHarnessProps {
  value: GallerySelectionValue;
  currentFolder: string;
  totalCount: number;
  children: ReactNode;
}

/**
 * The app's real selection wiring for tests: live batch actions, with their
 * dialogs mounted beside the subtree rather than inside it — which is where
 * `AppOverlays` puts them.
 */
export function GallerySelectionHarness({
  value,
  currentFolder,
  totalCount,
  children,
}: GallerySelectionHarnessProps) {
  const actions = useGallerySelectionActions({
    currentFolder,
    totalCount,
    selectedPaths: value.selectedPaths,
    selectedCount: value.selectedCount,
    exitSelectionMode: value.exitSelectionMode,
    onDeleted: value.onDeleted,
    onMoved: value.onMoved,
    onCopied: value.onCopied,
  });

  return (
    <GallerySelectionProvider {...value} actions={actions}>
      {children}
      <SelectionActionOverlays {...actions.overlay} />
    </GallerySelectionProvider>
  );
}
