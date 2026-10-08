import { useCallback, useEffect, useState, type RefObject } from "react";
import { useGalleryItemModal } from "@/features/gallery/hooks/useGalleryItemModal";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { GalleryItem } from "@/shared/types";
import type { WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";
import { readStored, writeStored } from "@/shared/lib/storage";

type UseGalleryOverlaysArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  folderResetToken: number;
  mainRef: RefObject<HTMLElement | null>;
  requestTransition?: WorkspaceTransition;
};

export function useGalleryOverlays({
  images,
  filteredItems,
  folderResetToken,
  mainRef,
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
    modalItems,
    openGalleryItem: openGalleryItemBase,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    goToIndex,
    removeGalleryItem,
  } = useGalleryItemModal(images, filteredItems, folderResetToken);

  useEffect(() => {
    setInstructionsOpen(false);
  }, [folderResetToken]);

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

  useScrollLock(instructionsOpen, "folder-instructions-modal-open", mainRef);

  return {
    selectedPath,
    selectedIndex,
    modalItems,
    openGalleryItem,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    goToIndex,
    removeGalleryItem,
    openSysPrompt,
    closeInstructions,
    instructionsOpen,
    focusView,
    setFocusView,
    editExpanded,
    setEditExpanded,
  };
}
