import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useGalleryModal } from "@/features/gallery/hooks/useGalleryModal";
import { buildSyspromptItem } from "@/features/gallery/lib/sysprompt";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { GalleryItem } from "@/shared/types";

type UseGalleryModalsArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  selectionEpoch: number;
  folder: string | undefined;
  sysprompt: GalleryItem | null;
  mainRef: RefObject<HTMLElement | null>;
};

/** Gallery item modal, sysprompt modal, and shared scroll-lock. */
export function useGalleryModals({
  images,
  filteredItems,
  selectionEpoch,
  folder,
  sysprompt,
  mainRef,
}: UseGalleryModalsArgs) {
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
  } = useGalleryModal(images, filteredItems, selectionEpoch);

  useEffect(() => {
    setSyspromptOpen(false);
  }, [selectionEpoch]);

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
