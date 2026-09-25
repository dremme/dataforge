import { useCallback, useEffect, useState, type RefObject } from "react";
import { useGalleryItemModal } from "@/features/gallery/hooks/useGalleryItemModal";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { GalleryItem } from "@/shared/types";

type UseGalleryOverlaysArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  folderResetToken: number;
  mainRef: RefObject<HTMLElement | null>;
};

export function useGalleryOverlays({
  images,
  filteredItems,
  folderResetToken,
  mainRef,
}: UseGalleryOverlaysArgs) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const {
    selectedPath,
    selectedIndex,
    modalItems,
    openGalleryItem: openGalleryItemBase,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    removeGalleryItem,
  } = useGalleryItemModal(images, filteredItems, folderResetToken);

  useEffect(() => {
    setInstructionsOpen(false);
  }, [folderResetToken]);

  const openGalleryItem = useCallback(
    (path: string) => {
      setInstructionsOpen(false);
      openGalleryItemBase(path);
    },
    [openGalleryItemBase],
  );

  const openSysPrompt = useCallback(() => {
    closeGalleryItem();
    setInstructionsOpen(true);
  }, [closeGalleryItem]);

  const closeInstructions = useCallback(() => setInstructionsOpen(false), []);

  const modalOpen = selectedPath !== null || instructionsOpen;
  const modalLockClass =
    selectedPath !== null ? "gallery-item-modal-open" : "folder-instructions-modal-open";
  useScrollLock(modalOpen, modalLockClass, mainRef);

  return {
    selectedPath,
    selectedIndex,
    modalItems,
    openGalleryItem,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    removeGalleryItem,
    openSysPrompt,
    closeInstructions,
    instructionsOpen,
  };
}
