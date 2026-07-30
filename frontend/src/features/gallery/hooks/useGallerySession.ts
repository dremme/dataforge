import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useBrowseCaptionPatch } from "@/features/gallery/hooks/useBrowseCaptionPatch";
import { useGalleryOverlays } from "@/features/gallery/hooks/useGalleryOverlays";
import { useGalleryQuery } from "@/features/gallery/hooks/useGalleryQuery";
import type { useGallerySelection } from "@/features/gallery/hooks/useGallerySelection";
import { useIssueResolverOverlay } from "@/features/gallery/hooks/useIssueResolverOverlay";
import { countResolvableIssues } from "@/features/gallery/lib/issues";
import type { BrowseResponse, GalleryItem } from "@/shared/types";

type GallerySelection = ReturnType<typeof useGallerySelection>;

type UseGallerySessionOptions = {
  selection: GallerySelection;
  items: GalleryItem[];
  folder: string | undefined;
  sysprompt: GalleryItem | null;
  setBrowse: Dispatch<SetStateAction<BrowseResponse | null>>;
  mainRef: RefObject<HTMLElement | null>;
  /** Full silent reload + fingerprint sync (after delete/move/import). */
  refreshFolder: () => Promise<void>;
  /** Fingerprint-only sync after local browse patches (caption save). */
  syncBaseline: () => Promise<void> | void;
};

/**
 * Gallery filters, item/sysprompt modals, caption patch, issue resolver.
 * Selection is owned by the caller so navigation can clear it first.
 */
export function useGallerySession({
  selection,
  items,
  folder,
  sysprompt,
  setBrowse,
  mainRef,
  refreshFolder,
  syncBaseline,
}: UseGallerySessionOptions) {
  const {
    selectionEpoch,
    clearSelection,
    selectionMode,
    selectedPaths,
    selectedCount,
    getJobPaths,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    selectAllPaths,
    removeSelectedPaths,
    clearSelectedPaths,
  } = selection;

  const query = useGalleryQuery(items);
  const issueCount = countResolvableIssues(items);
  const handleCaptionSaved = useBrowseCaptionPatch(setBrowse);
  const issueResolver = useIssueResolverOverlay();

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
    onJsonEditorOpenChange,
  } = useGalleryOverlays({
    images: items,
    filteredItems: query.filteredItems,
    selectionEpoch,
    folder,
    sysprompt,
    mainRef,
  });

  const onCaptionSaved = useCallback(
    (path: string, update: Parameters<typeof handleCaptionSaved>[1]) => {
      handleCaptionSaved(path, update);
      void syncBaseline();
    },
    [handleCaptionSaved, syncBaseline],
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

  // A copy keeps every item and its selection; only subfolder counts move.
  const onGalleryItemsCopied = useCallback(async () => {
    await refreshFolder();
  }, [refreshFolder]);

  const handleSelectAllPaths = useCallback(() => {
    selectAllPaths(query.filteredItems.map((item) => item.path));
  }, [query.filteredItems, selectAllPaths]);

  return {
    clearSelection,
    selectionMode,
    selectedPaths,
    selectedCount,
    getJobPaths,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    clearSelectedPaths,
    handleSelectAllPaths,
    query,
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
    onJsonEditorOpenChange,
    issueResolver,
    onCaptionSaved,
    onGalleryItemDeleted,
    onGalleryItemsDeleted,
    onGalleryItemsMoved,
    onGalleryItemsCopied,
  };
}
