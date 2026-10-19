import { useCallback, useMemo, useState } from "react";
import type { GalleryItem } from "@/shared/types";
import { useChanged } from "@/shared/hooks/useChanged";

export function useGalleryItemDialog(
  images: GalleryItem[],
  filteredItems: GalleryItem[],
  resetToken?: unknown,
) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dialogNavigationPaths, setDialogNavigationPaths] = useState<string[] | null>(null);

  if (useChanged(resetToken)) {
    setSelectedPath(null);
    setDialogNavigationPaths(null);
  }

  const dialogItems = useMemo(() => {
    if (!dialogNavigationPaths) return [];
    // One lookup table per listing: a find per path is quadratic on a 10k-item folder.
    const byPath = new Map(images.map((item) => [item.path, item]));
    return dialogNavigationPaths
      .map((path) => byPath.get(path))
      .filter((item): item is GalleryItem => item != null);
  }, [images, dialogNavigationPaths]);

  const selectedIndex = useMemo(() => {
    if (!selectedPath) return -1;
    return dialogItems.findIndex((item) => item.path === selectedPath);
  }, [dialogItems, selectedPath]);

  if (selectedPath && !images.some((item) => item.path === selectedPath)) {
    setSelectedPath(null);
    setDialogNavigationPaths(null);
  }

  const openGalleryItem = useCallback(
    (path: string) => {
      setDialogNavigationPaths(filteredItems.map((item) => item.path));
      setSelectedPath(path);
    },
    [filteredItems],
  );

  const closeGalleryItem = useCallback(() => {
    setSelectedPath(null);
    setDialogNavigationPaths(null);
  }, []);

  const goToPrevious = useCallback(() => {
    if (!selectedPath || selectedIndex < 0 || dialogItems.length === 0) return;
    const nextIndex = (selectedIndex - 1 + dialogItems.length) % dialogItems.length;
    setSelectedPath(dialogItems[nextIndex].path);
  }, [dialogItems, selectedIndex, selectedPath]);

  const goToNext = useCallback(() => {
    if (!selectedPath || selectedIndex < 0 || dialogItems.length === 0) return;
    const nextIndex = (selectedIndex + 1) % dialogItems.length;
    setSelectedPath(dialogItems[nextIndex].path);
  }, [dialogItems, selectedIndex, selectedPath]);

  const goToIndex = useCallback(
    (index: number) => {
      const target = dialogItems[index];
      if (target) setSelectedPath(target.path);
    },
    [dialogItems],
  );

  const removeGalleryItem = useCallback(
    (deletedPath: string) => {
      setDialogNavigationPaths((paths) => {
        if (!paths) return null;
        return paths.filter((path) => path !== deletedPath);
      });

      setSelectedPath((current) => {
        if (current !== deletedPath) return current;

        const remaining = (dialogNavigationPaths ?? []).filter((path) => path !== deletedPath);
        if (remaining.length === 0) return null;

        const index = (dialogNavigationPaths ?? []).indexOf(deletedPath);
        const nextIndex = Math.min(Math.max(index, 0), remaining.length - 1);
        return remaining[nextIndex];
      });
    },
    [dialogNavigationPaths],
  );

  const renameGalleryItem = useCallback((path: string, renamedPath: string) => {
    setDialogNavigationPaths(
      (paths) => paths && paths.map((entry) => (entry === path ? renamedPath : entry)),
    );
    setSelectedPath((current) => (current === path ? renamedPath : current));
  }, []);

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
  };
}
