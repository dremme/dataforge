import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { buildSyspromptItem, useGalleryModal } from "@/features/gallery";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import type { GalleryItem } from "@/shared/types";

type UseAppModalsArgs = {
  images: GalleryItem[];
  filteredItems: GalleryItem[];
  selectionEpoch: number;
  syspromptOpen: boolean;
  setSyspromptOpen: (open: boolean) => void;
  folder: string | undefined;
  sysprompt: GalleryItem | null;
  mainRef: RefObject<HTMLElement | null>;
};

export function useAppModals({
  images,
  filteredItems,
  selectionEpoch,
  syspromptOpen,
  setSyspromptOpen,
  folder,
  sysprompt,
  mainRef,
}: UseAppModalsArgs) {
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

  const openGalleryItem = useCallback(
    (path: string) => {
      setSyspromptOpen(false);
      openGalleryItemBase(path);
    },
    [openGalleryItemBase, setSyspromptOpen],
  );

  const openSysPrompt = useCallback(() => {
    closeGalleryItem();
    setSyspromptOpen(true);
  }, [closeGalleryItem, setSyspromptOpen]);

  const closeSysPrompt = useCallback(() => setSyspromptOpen(false), [setSyspromptOpen]);

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
