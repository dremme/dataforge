import { useCallback, useState } from "react";
import { useGalleryItemDialog } from "@/features/gallery/hooks/useGalleryItemDialog";
import type { GalleryItem } from "@/shared/types";
import type { WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";
import { readStored, writeStored } from "@/shared/lib/storage";
import { useChanged } from "@/shared/hooks/useChanged";

type UseGalleryOverlaysArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  folderResetToken: number;
  requestTransition?: WorkspaceTransition;
};

export function useGalleryOverlays({
  images,
  filteredItems,
  folderResetToken,
  requestTransition,
}: UseGalleryOverlaysArgs) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [focusView, setFocusViewState] = useState(
    () => readStored("gallery-focus-view") === "true",
  );
  const setFocusView = useCallback((expanded: boolean) => {
    setFocusViewState(expanded);
    writeStored("gallery-focus-view", String(expanded));
  }, []);
  // Editing or capture expands a docked view for its duration without saving that layout.
  const [editExpanded, setEditExpanded] = useState(false);

  const {
    selectedPath,
    selectedIndex,
    dialogItems,
    openGalleryItem: openGalleryItemBase,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    goToIndex,
    removeGalleryItem,
    renameGalleryItem,
  } = useGalleryItemDialog(images, filteredItems, folderResetToken);

  if (useChanged(folderResetToken)) {
    setInstructionsOpen(false);
  }

  const openGalleryItem = useCallback(
    (path: string) => {
      const open = () => {
        setInstructionsOpen(false);
        openGalleryItemBase(path);
      };
      if (requestTransition) void requestTransition(open);
      else open();
    },
    [openGalleryItemBase, requestTransition],
  );

  const openSysPrompt = useCallback(() => {
    const open = () => {
      setInstructionsOpen(true);
    };
    if (requestTransition) void requestTransition(open);
    else open();
  }, [requestTransition]);

  const closeInstructions = useCallback(() => setInstructionsOpen(false), []);

  return {
    selectedPath,
    selectedIndex,
    dialogItems,
    openGalleryItem,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    goToIndex,
    removeGalleryItem,
    renameGalleryItem,
    openSysPrompt,
    closeInstructions,
    instructionsOpen,
    focusView,
    setFocusView,
    editExpanded,
    setEditExpanded,
  };
}
