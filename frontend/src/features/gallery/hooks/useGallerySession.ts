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
  /** Full silent reload + fingerprint sync (after delete/move/import). */
  refreshFolder: () => Promise<void>;
  /** Fingerprint-only sync after local folder patches (caption save). */
  syncBaseline: () => Promise<void> | void;
};

/**
 * Gallery filters, item/sysprompt modals, caption patch, issue resolver.
 * Selection is owned by the caller so navigation can clear it first.
 */
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

  // A selected path outlives the file it names. A rename — the batch rename job,
  // Explorer, another window — reaches the folder as a delta, and the selection
  // would otherwise keep pointing at a name nothing on disk answers to, so the
  // next move, copy, or delete fails on a file the user can plainly see.
  //
  // Only the folder's own contents prune it. Narrowing the view (search, sort,
  // filters) deliberately does not — see `useGallerySelection`.
  useEffect(() => {
    if (selectedPathsList.length === 0) return;
    const present = new Set(items.map((item) => item.path));
    const stale = selectedPathsList.filter((path) => !present.has(path));
    if (stale.length > 0) {
      removeSelectedPaths(stale);
    }
  }, [items, removeSelectedPaths, selectedPathsList]);

  const query = useGalleryQuery(items);

  /**
   * The selection as the current filters leave it — what every count, every
   * button state and every batch action operates on.
   *
   * Derived rather than pruned: `selectedPaths` keeps the entries the filters
   * hide, so widening the filter restores them instead of a stray keystroke in
   * the search box destroying the selection. While hidden they are inert, which
   * is what stops a delete from reaching an item the user cannot see.
   */
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

  /** Paths for an automation run: what is selected *and* on screen, or the whole folder. */
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
    onJsonEditorOpenChange,
  } = useGalleryOverlays({
    images: items,
    filteredItems: query.filteredItems,
    folderResetToken,
    folder: folderPath,
    sysprompt,
    mainRef,
  });

  // Reopening on a path that has dropped out of the filtered set would leave
  // `selectedPath` set with a `selectedIndex` of -1: nothing renders while the
  // scroll lock stays held. The check mirrors what `openGalleryItem` snapshots,
  // so the two cannot disagree.
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

  // Hands a single item to the issue resolver as a queue of one. Both state
  // updates land in the same commit, so the item modal never overlaps it.
  // The guard matters: an item the queue would filter out leaves the resolver
  // open with nothing to render and no close to return from, shutting both
  // modals at once. The path rather than the item is the return ticket, so the
  // reopened modal reads the saved caption from the live folder list.
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

  // A copy keeps every item and its selection; only subfolder counts move.
  const onGalleryItemsCopied = useCallback(async () => {
    await refreshFolder();
  }, [refreshFolder]);

  /**
   * Ctrl/Cmd+click, and a plain click once selection mode is on. Entering is
   * idempotent, so the one handler covers both without the card knowing which
   * gesture it was.
   */
  const handleToggleSelectPath = useCallback(
    (path: string) => {
      enterSelectionMode();
      toggleSelectedPath(path);
    },
    [enterSelectionMode, toggleSelectedPath],
  );

  /**
   * Shift+click. The range is measured in the order the view is showing.
   *
   * Read through a ref so this handler never changes identity: it reaches every
   * card as a prop, and a new function each time the folder's items changed
   * would re-render the whole grid — the thing `GalleryCard`'s `memo` is for.
   */
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
    onJsonEditorOpenChange,
    issueResolver,
    onResolveGalleryItemIssue,
    onCaptionSaved,
    onGalleryItemDeleted,
    onGalleryItemsDeleted,
    onGalleryItemsMoved,
    onGalleryItemsCopied,
  };
}
