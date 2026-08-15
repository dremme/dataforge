import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useGalleryItemModal } from "@/features/gallery/hooks/useGalleryItemModal";
import { buildSyspromptItem } from "@/features/gallery/lib/sysprompt";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { GalleryItem } from "@/shared/types";

type UseGalleryOverlaysArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  folderResetToken: number;
  folder: string | undefined;
  sysprompt: GalleryItem | null;
  mainRef: RefObject<HTMLElement | null>;
};

/**
 * Coordinates the gallery's overlay surfaces: which one is open, keeping the
 * item modal and sysprompt mutually exclusive, and resolving the scroll-lock
 * class from their precedence.
 */
export function useGalleryOverlays({
  images,
  filteredItems,
  folderResetToken,
  folder,
  sysprompt,
  mainRef,
}: UseGalleryOverlaysArgs) {
  const [syspromptOpen, setSyspromptOpen] = useState(false);

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
    setSyspromptOpen(false);
  }, [folderResetToken]);

  const openGalleryItem = useCallback(
    (path: string) => {
      setSyspromptOpen(false);
      openGalleryItemBase(path);
    },
    [openGalleryItemBase],
  );

  const openSysPrompt = useCallback(() => {
    closeGalleryItem();
    setSyspromptOpen(true);
  }, [closeGalleryItem]);

  const closeSysPrompt = useCallback(() => setSyspromptOpen(false), []);

  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);

  useEffect(() => {
    if (!selectedPath) {
      setJsonEditorOpen(false);
    }
  }, [selectedPath]);

  const modalOpen = selectedPath !== null || syspromptOpen;
  const modalLockClass = jsonEditorOpen
    ? "gallery-item-json-editor-open"
    : selectedPath !== null
      ? "gallery-item-modal-open"
      : "sysprompt-modal-open";
  useScrollLock(modalOpen, modalLockClass, mainRef);

  const syspromptModalItem = useMemo(
    () => (folder ? buildSyspromptItem(folder, sysprompt) : null),
    [folder, sysprompt],
  );

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
    closeSysPrompt,
    syspromptOpen,
    syspromptModalItem,
    onJsonEditorOpenChange: setJsonEditorOpen,
  };
}
