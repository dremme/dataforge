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
  children: ReactNode;
}

export function GallerySelectionHarness({
  value,
  currentFolder,
  children,
}: GallerySelectionHarnessProps) {
  const actions = useGallerySelectionActions({
    currentFolder,
    visibleSelectedPaths: value.visibleSelectedPaths,
    visibleSelectedCount: value.visibleSelectedCount,
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
