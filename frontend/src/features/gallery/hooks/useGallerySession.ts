import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useFolderCaptionPatch } from "@/features/gallery/hooks/useFolderCaptionPatch";
import { useGalleryDisplayMode } from "@/features/gallery/hooks/useGalleryDisplayMode";
import { useGalleryOverlays } from "@/features/gallery/hooks/useGalleryOverlays";
import { useGalleryQuery } from "@/features/gallery/hooks/useGalleryQuery";
import type { useGallerySelection } from "@/features/gallery/hooks/useGallerySelection";
import { useIssueResolverOverlay } from "@/features/gallery/hooks/useIssueResolverOverlay";
import { countResolvableIssues, isResolvableIssueItem } from "@/features/gallery/lib/issues";
import type { FolderResponse, GalleryItem } from "@/shared/types";

type GallerySelection = ReturnType<typeof useGallerySelection>;

type UseGallerySessionOptions = {
  selection: GallerySelection;
  items: GalleryItem[];
  folderPath: string | undefined;
  sysprompt: GalleryItem | null;
  setFolder: Dispatch<SetStateAction<FolderResponse | null>>;
  mainRef: RefObject<HTMLElement | null>;
  refreshFolder: () => Promise<void>;
  syncBaseline: () => Promise<void> | void;
};

export function useGallerySession({
  selection,
  items,
  folderPath,
  sysprompt,
  setFolder,
  mainRef,
  refreshFolder,
  syncBaseline,
}: UseGallerySessionOptions) {
  const {
    folderResetToken,
    selectionMode,
    selectedPaths,
    selectedPathsList,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    selectPathRange,
    selectAllPaths,
    invertSelectedPaths,
    removeSelectedPaths,
    clearSelectedPaths,
  } = selection;

  // Prune paths gone from disk; a rename would fail the next move/copy/delete.
  // Search/sort/filters deliberately do not prune — see useGallerySelection.
  useEffect(() => {
    if (selectedPathsList.length === 0) return;
    const present = new Set(items.map((item) => item.path));
    const stale = selectedPathsList.filter((path) => !present.has(path));
    if (stale.length > 0) {
      removeSelectedPaths(stale);
    }
  }, [items, removeSelectedPaths, selectedPathsList]);

  const query = useGalleryQuery(items);

  // Derived, not pruned: hidden paths stay so widening restores them and no delete reaches them.
  const visibleSelectedPaths = useMemo(() => {
    const visible = new Set<string>();
    for (const item of query.filteredItems) {
      if (selectedPaths.has(item.path)) {
        visible.add(item.path);
      }
    }
    return visible;
  }, [query.filteredItems, selectedPaths]);

  const visibleSelectedCount = visibleSelectedPaths.size;

  const getJobPaths = useCallback((): string[] | undefined => {
    if (!selectionMode || visibleSelectedCount === 0) return undefined;
    return Array.from(visibleSelectedPaths);
  }, [selectionMode, visibleSelectedCount, visibleSelectedPaths]);

  const { displayMode, setDisplayMode } = useGalleryDisplayMode(folderPath);
  const issueCount = countResolvableIssues(items);
  const handleCaptionSaved = useFolderCaptionPatch(setFolder);

  const {
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
  } = useGalleryOverlays({
    images: items,
    filteredItems: query.filteredItems,
    folderResetToken,
    folder: folderPath,
    sysprompt,
    mainRef,
  });

  // Skip paths out of the filtered set: selectedIndex is -1 with the scroll lock still held.
  const returnToGalleryItem = useCallback(
    (path: string) => {
      if (!query.filteredItems.some((item) => item.path === path)) return;
      openGalleryItem(path);
    },
    [openGalleryItem, query.filteredItems],
  );

  const issueResolver = useIssueResolverOverlay(returnToGalleryItem);
  const { openIssueResolver } = issueResolver;

  const onCaptionSaved = useCallback(
    (path: string, update: Parameters<typeof handleCaptionSaved>[1]) => {
      handleCaptionSaved(path, update);
      void syncBaseline();
    },
    [handleCaptionSaved, syncBaseline],
  );

  // Same commit so the item modal never overlaps the resolver.
  // Guard: a non-resolvable item opens the resolver empty with no close to return from.
  const onResolveGalleryItemIssue = useCallback(
    (item: GalleryItem) => {
      if (!isResolvableIssueItem(item)) return;
      closeGalleryItem();
      openIssueResolver([item], item.path);
    },
    [closeGalleryItem, openIssueResolver],
  );

  const onGalleryItemDeleted = useCallback(
    (path: string) => {
      removeGalleryItem(path);
      void refreshFolder();
    },
    [removeGalleryItem, refreshFolder],
  );

  const onGalleryItemsDeleted = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        removeGalleryItem(path);
      }
      removeSelectedPaths(paths);
      await refreshFolder();
    },
    [removeGalleryItem, removeSelectedPaths, refreshFolder],
  );

  const onGalleryItemsMoved = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        removeGalleryItem(path);
      }
      removeSelectedPaths(paths);
      await refreshFolder();
    },
    [removeGalleryItem, removeSelectedPaths, refreshFolder],
  );

  const onGalleryItemsCopied = useCallback(async () => {
    await refreshFolder();
  }, [refreshFolder]);

  const handleToggleSelectPath = useCallback(
    (path: string) => {
      enterSelectionMode();
      toggleSelectedPath(path);
    },
    [enterSelectionMode, toggleSelectedPath],
  );

  // Ref so this handler keeps identity; a new function per folder change re-renders the grid.
  const filteredItemsRef = useRef(query.filteredItems);
  filteredItemsRef.current = query.filteredItems;

  const handleExtendSelectionTo = useCallback(
    (path: string) => {
      enterSelectionMode();
      selectPathRange(
        filteredItemsRef.current.map((item) => item.path),
        path,
      );
    },
    [enterSelectionMode, selectPathRange],
  );

  const handleSelectAllPaths = useCallback(() => {
    enterSelectionMode();
    selectAllPaths(query.filteredItems.map((item) => item.path));
  }, [enterSelectionMode, query.filteredItems, selectAllPaths]);

  const handleInvertSelection = useCallback(() => {
    if (!selectionMode) return;
    invertSelectedPaths(query.filteredItems.map((item) => item.path));
  }, [invertSelectedPaths, query.filteredItems, selectionMode]);

  return {
    selectionMode,
    selectedPaths,
    visibleSelectedPaths,
    visibleSelectedCount,
    getJobPaths,
    enterSelectionMode,
    exitSelectionMode,
    handleToggleSelectPath,
    handleExtendSelectionTo,
    clearSelectedPaths,
    handleSelectAllPaths,
    handleInvertSelection,
    query,
    displayMode,
    setDisplayMode,
    issueCount,
    openGalleryItem,
    openSysPrompt,
    closeSysPrompt,
    syspromptOpen,
    syspromptModalItem,
    selectedPath,
    selectedIndex,
    modalItems,
    closeGalleryItem,
    goToPrevious,
    goToNext,
    issueResolver,
    onResolveGalleryItemIssue,
    onCaptionSaved,
    onGalleryItemDeleted,
    onGalleryItemsDeleted,
    onGalleryItemsMoved,
    onGalleryItemsCopied,
  };
}
