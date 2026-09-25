import { useCallback, useEffect, useState, type RefObject } from "react";
import { useGalleryItemModal } from "@/features/gallery/hooks/useGalleryItemModal";
import type { InstructionKind } from "@/shared/api/folderInstructions";
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
  const [instructionsTab, setInstructionsTab] = useState<InstructionKind>("sysprompt");

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

  const openInstructionsTab = useCallback(
    (tab: InstructionKind) => {
      closeGalleryItem();
      setInstructionsTab(tab);
      setInstructionsOpen(true);
    },
    [closeGalleryItem],
  );

  const openSysPrompt = useCallback(() => openInstructionsTab("sysprompt"), [openInstructionsTab]);
  const openCaptionRules = useCallback(
    () => openInstructionsTab("caption_rules"),
    [openInstructionsTab],
  );

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
    openCaptionRules,
    closeInstructions,
    instructionsOpen,
    instructionsTab,
  };
}
