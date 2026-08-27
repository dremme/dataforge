import { useCallback, useEffect, useMemo, useState } from "react";
import {
  pauseGalleryPreviewLoader,
  resumeGalleryPreviewLoader,
} from "@/features/gallery/lib/previewLoader";
import type { GalleryItem } from "@/shared/types";

export function useGalleryItemModal(
  images: GalleryItem[],
  filteredItems: GalleryItem[],
  resetToken?: unknown,
) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [modalNavigationPaths, setModalNavigationPaths] = useState<string[] | null>(null);

  useEffect(() => {
    setSelectedPath(null);
    setModalNavigationPaths(null);
  }, [resetToken]);

  const modalItems = useMemo(() => {
    if (!modalNavigationPaths) return [];
    return modalNavigationPaths
      .map((path) => images.find((item) => item.path === path))
      .filter((item): item is GalleryItem => item != null);
  }, [images, modalNavigationPaths]);

  const selectedIndex = useMemo(() => {
    if (!selectedPath) return -1;
    return modalItems.findIndex((item) => item.path === selectedPath);
  }, [modalItems, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    if (!images.some((item) => item.path === selectedPath)) {
      setSelectedPath(null);
      setModalNavigationPaths(null);
    }
  }, [images, selectedPath]);

  useEffect(() => {
    if (selectedPath) {
      pauseGalleryPreviewLoader();
      return;
    }

    resumeGalleryPreviewLoader();
  }, [selectedPath]);

  const openGalleryItem = useCallback(
    (path: string) => {
      setModalNavigationPaths(filteredItems.map((item) => item.path));
      setSelectedPath(path);
    },
    [filteredItems],
  );

  const closeGalleryItem = useCallback(() => {
    setSelectedPath(null);
    setModalNavigationPaths(null);
  }, []);

  const goToPrevious = useCallback(() => {
    if (!selectedPath || selectedIndex < 0 || modalItems.length === 0) return;
    const nextIndex = (selectedIndex - 1 + modalItems.length) % modalItems.length;
    setSelectedPath(modalItems[nextIndex].path);
  }, [modalItems, selectedIndex, selectedPath]);

  const goToNext = useCallback(() => {
    if (!selectedPath || selectedIndex < 0 || modalItems.length === 0) return;
    const nextIndex = (selectedIndex + 1) % modalItems.length;
    setSelectedPath(modalItems[nextIndex].path);
  }, [modalItems, selectedIndex, selectedPath]);

  const removeGalleryItem = useCallback(
    (deletedPath: string) => {
      setModalNavigationPaths((paths) => {
        if (!paths) return null;
        return paths.filter((path) => path !== deletedPath);
      });

      setSelectedPath((current) => {
        if (current !== deletedPath) return current;

        const remaining = (modalNavigationPaths ?? []).filter((path) => path !== deletedPath);
        if (remaining.length === 0) return null;

        const index = (modalNavigationPaths ?? []).indexOf(deletedPath);
        const nextIndex = Math.min(Math.max(index, 0), remaining.length - 1);
        return remaining[nextIndex];
      });
    },
    [modalNavigationPaths],
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
  };
}
