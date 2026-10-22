import { useCallback, useMemo, useState } from "react";
import type { GalleryItem } from "@/shared/types";
import { useChanged } from "@/shared/hooks/useChanged";

/** The item taking over from `removedPath`: the next survivor, else the nearest one before it. */
function successorPath(
  paths: readonly string[],
  removedPath: string,
  isPresent: (path: string) => boolean,
): string | null {
  const index = paths.indexOf(removedPath);
  const after = paths.slice(index + 1).find(isPresent);
  if (after !== undefined) return after;
  for (let before = index - 1; before >= 0; before--) {
    if (isPresent(paths[before])) return paths[before];
  }
  return null;
}

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

  // A folder push can drop the open item before its delete request returns: advance, never close.
  if (selectedPath && !images.some((item) => item.path === selectedPath)) {
    const present = new Set(images.map((item) => item.path));
    const successor = successorPath(dialogNavigationPaths ?? [], selectedPath, (path) =>
      present.has(path),
    );
    setSelectedPath(successor);
    if (!successor) setDialogNavigationPaths(null);
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
        return successorPath(
          dialogNavigationPaths ?? [],
          deletedPath,
          (path) => path !== deletedPath,
        );
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
