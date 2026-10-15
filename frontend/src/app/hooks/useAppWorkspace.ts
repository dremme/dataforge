import { useCallback, useMemo, useRef } from "react";
import { useAutomationHost } from "@/features/automation/hooks/useAutomationHost";
import { useComfyPresetsAvailable } from "@/features/automation/hooks/useComfyPresets";
import { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useCreateFolderDialog } from "@/features/folder/hooks/useCreateFolderDialog";
import { useDeleteFolderDialog } from "@/features/folder/hooks/useDeleteFolderDialog";
import { useFolderChangeDetection } from "@/features/folder/hooks/useFolderChangeDetection";
import { useFolderFileDrop } from "@/features/folder/hooks/useFolderFileDrop";
import { useFolderNavigation } from "@/features/folder/hooks/useFolderNavigation";
import { useFolderScrollPosition } from "@/features/folder/hooks/useFolderScrollPosition";
import { useSubfolderStats } from "@/features/folder/hooks/useSubfolderStats";
import { useGallerySelection } from "@/features/gallery/hooks/useGallerySelection";
import { useGallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";
import { useGallerySession } from "@/features/gallery/hooks/useGallerySession";
import { useDuplicateResolverOverlay } from "@/features/gallery/hooks/useDuplicateResolverOverlay";
import { useCandidateReviewOverlay } from "@/features/gallery/hooks/useCandidateReviewOverlay";
import { useSidecarSweep } from "@/features/gallery/hooks/useSidecarSweep";
import { useSettleAllCandidates } from "@/features/gallery/hooks/useSettleAllCandidates";
import {
  countDuplicateGroups,
  countDuplicates,
  isDuplicateItem,
} from "@/features/gallery/lib/duplicates";
import { jobEligibleItems } from "@/features/gallery/lib/itemKind";
import { isCandidateItem } from "@/features/gallery/lib/candidateReview";
import { useStatsDrawer } from "@/features/gallery/hooks/useStatsDrawer";
import { useSettingsModal } from "@/features/settings/hooks/useSettingsModal";
import { useShortcutsDialog } from "@/features/shortcuts/hooks/useShortcutsDialog";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { useQuickActionHost } from "@/features/quickAction/hooks/useQuickActionHost";
import { filterSubfoldersBySearch } from "@/features/gallery/lib/query";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import type { GalleryItem, JobType } from "@/shared/types";
import { useWorkspaceTransitions } from "@/app/hooks/useWorkspaceTransitions";

export function useAppWorkspace() {
  const { transitionRef, requestTransition } = useWorkspaceTransitions();
  const mainRef = useRef<HTMLElement>(null);
  const selection = useGallerySelection();
  const { ostrisAvailable } = useJobs();
  const comfyPresetsAvailable = useComfyPresetsAvailable();

  const {
    folder,
    loading,
    refreshing,
    error,
    navigateTo: navigateToBase,
    setFolder,
    reloadFolder: refreshFolder,
    refreshFolderAndCounts,
    scrollIntent,
  } = useFolderNavigation(selection.clearSelection, requestTransition);

  const navigateTo = useCallback(
    (path?: string) => requestTransition(() => navigateToBase(path)),
    [navigateToBase, requestTransition],
  );

  const folderNotFound = error?.kind === "folder-not-found";

  useFolderScrollPosition({
    intent: scrollIntent,
    folderPath: folder?.path,
    loading,
    hasError: Boolean(error),
  });
  const folderLabel =
    folder?.breadcrumbs[folder.breadcrumbs.length - 1]?.name ?? folder?.path ?? "this folder";

  const folderAutomation = useFolderAutomation(folder?.path, refreshFolder);

  // Kept running while the folder is missing, so it recovers when a drive or folder comes back.
  const { syncBaseline } = useFolderChangeDetection(folder?.path);

  const createFolder = useCreateFolderDialog({
    parentFolder: folder?.path,
    parentLabel: folderLabel,
    enabled: Boolean(folder?.path) && !folderNotFound,
    onCreated: async (path) => {
      await navigateTo(path);
      await syncBaseline();
    },
  });

  const fileDrop = useFolderFileDrop({
    folderPath: folder?.path,
    enabled: Boolean(folder) && !folderNotFound && !loading,
    onImported: refreshFolder,
  });

  const subfolders = useMemo(() => folder?.subfolders ?? [], [folder?.subfolders]);
  const items = useMemo(() => folder?.items ?? [], [folder?.items]);

  useSubfolderStats(folder?.path, folder?.fingerprint, subfolders, !folderNotFound);

  const deleteFolder = useDeleteFolderDialog({
    folderPath: folder?.path,
    folderLabel,
    // The backend still refuses a folder holding files the gallery does not list.
    enabled:
      Boolean(folder?.parent) &&
      !folderNotFound &&
      !loading &&
      items.length === 0 &&
      subfolders.length === 0,
    onDeleted: navigateTo,
  });

  useDocumentTitle(folder?.path, folder?.breadcrumbs ?? []);

  const gallery = useGallerySession({
    selection,
    items,
    folderPath: folder?.path,
    setFolder,
    mainRef,
    refreshFolder,
    syncBaseline,
    requestTransition,
  });

  const { searchQuery, searchRegex, searchNames } = gallery.query;

  // Caption-only search cannot match folders; leave the subfolder list unfiltered.
  const filteredSubfolders = useMemo(
    () =>
      searchNames ? filterSubfoldersBySearch(subfolders, searchQuery, searchRegex) : subfolders,
    [subfolders, searchQuery, searchRegex, searchNames],
  );

  const selectionActions = useGallerySelectionActions({
    currentFolder: folder?.path,
    visibleSelectedPaths: gallery.visibleSelectedPaths,
    visibleSelectedCount: gallery.visibleSelectedCount,
    onDeleted: gallery.onGalleryItemsDeleted,
    onMoved: gallery.onGalleryItemsMoved,
    onCopied: gallery.onGalleryItemsCopied,
  });

  const duplicateFileCount = useMemo(() => countDuplicates(items), [items]);
  const emptyCaptionCount = useMemo(
    () => items.filter((item) => item.caption_status === "empty").length,
    [items],
  );
  const sidecarSweep = useSidecarSweep({
    folderPath: folder?.path,
    folderLabel,
    issueCount: gallery.issueCount,
    duplicateCount: duplicateFileCount,
    emptyCaptionCount,
    onSwept: refreshFolder,
  });

  const statsDrawer = useStatsDrawer();
  const settings = useSettingsModal();
  const shortcuts = useShortcutsDialog();

  // Refresh on close: per-deletion reloads race the watcher's push against the frozen queue.
  const duplicateResolverOverlay = useDuplicateResolverOverlay(
    refreshFolder,
    gallery.returnToGalleryItem,
  );
  const duplicateGroupCount = useMemo(() => countDuplicateGroups(items), [items]);
  const candidateSourcePaths = useMemo(
    () => items.filter(isCandidateItem).map((item) => item.path),
    [items],
  );
  const candidateCount = candidateSourcePaths.length;

  const candidateReviewOverlay = useCandidateReviewOverlay(
    refreshFolder,
    gallery.returnToGalleryItem,
  );
  const { openCandidateReview } = candidateReviewOverlay;
  const { closeGalleryItem } = gallery;

  const reviewGalleryItemCandidate = useCallback(
    (item: GalleryItem) => {
      if (!folder?.path || !isCandidateItem(item)) return;
      void openCandidateReview(folder.path, items, { path: item.path, onOpen: closeGalleryItem });
    },
    [closeGalleryItem, folder?.path, items, openCandidateReview],
  );

  const candidateReview = { ...candidateReviewOverlay, reviewGalleryItemCandidate };

  const { openDuplicateResolver } = duplicateResolverOverlay;
  const resolveGalleryItemDuplicate = useCallback(
    (item: GalleryItem) => {
      if (!folder?.path || !isDuplicateItem(item)) return;
      void openDuplicateResolver(folder.path, { path: item.path, onOpen: closeGalleryItem });
    },
    [closeGalleryItem, folder?.path, openDuplicateResolver],
  );
  const duplicateResolver = { ...duplicateResolverOverlay, resolveGalleryItemDuplicate };
  const settleAllCandidates = useSettleAllCandidates({
    folderLabel,
    folderItemCount: items.length,
    candidatePaths: candidateSourcePaths,
    selectedPaths:
      selection.selectionMode && gallery.visibleSelectedCount > 0
        ? gallery.visibleSelectedPaths
        : null,
    onSettled: refreshFolder,
  });

  // Set from useAutomationHost's return below, which in turn needs these handlers.
  const requestJobStartRef = useRef<
    (jobType: JobType, paths?: string[], kind?: "selected" | "visible") => void
  >(() => {});

  const retryFailedFiles = useCallback(
    (jobType: JobType, paths: string[]) => {
      gallery.selectOnlyPaths(paths);
      requestJobStartRef.current(jobType, paths, "selected");
    },
    [gallery],
  );

  const jobItems = useMemo(() => jobEligibleItems(items), [items]);
  const automation = useAutomationHost({
    folder: folder?.path,
    breadcrumbs: folder?.breadcrumbs ?? [],
    items: jobItems,
    hasSysprompt: folder?.has_sysprompt ?? false,
    syspromptApplies: folder?.sysprompt_applies ?? false,
    hasCaptionRules: folder?.has_caption_rules ?? false,
    hasCaptionBackup: folder?.has_caption_backup ?? false,
    ostrisAvailable,
    comfyPresetsAvailable,
    getJobPaths: gallery.getJobPaths,
    jobScopeKind: gallery.jobScopeKind,
    requestTransition,
    automation: folderAutomation,
    onEditSysprompt: gallery.openSysPrompt,
    issueCount: gallery.issueCount,
    onResolveIssues:
      gallery.issueCount > 0
        ? () =>
            void requestTransition(() => {
              gallery.closeGalleryItem();
              gallery.issueResolver.openIssueResolver(items);
            })
        : undefined,
    duplicateGroupCount,
    onResolveDuplicates:
      duplicateGroupCount > 0 && folder?.path
        ? () =>
            void requestTransition(async () => {
              gallery.closeGalleryItem();
              await duplicateResolver.openDuplicateResolver(folder.path);
            })
        : undefined,
    candidateCount,
    onReviewCandidates:
      candidateCount > 0 && folder?.path
        ? () =>
            void requestTransition(async () => {
              gallery.closeGalleryItem();
              await candidateReview.openCandidateReview(folder.path, items);
            })
        : undefined,
    onOpenItem: gallery.openGalleryItem,
    onRetryFailed: retryFailedFiles,
  });

  requestJobStartRef.current = automation.requestStart;

  // Memoized: an inline bag would change identity every render and defeat the palette's memo.
  const quickActionFilters = useMemo(
    () => ({
      hasActiveFilters: gallery.query.hasActiveFilters,
      mediaType: gallery.query.mediaTypeFilter,
      caption: gallery.query.filter,
      file: gallery.query.fileFilter,
      counts: {
        mediaType: gallery.query.mediaTypeFilterCounts,
        caption: gallery.query.filterCounts,
        file: gallery.query.fileFilterCounts,
      },
      onSelectMediaType: gallery.query.setMediaTypeFilter,
      onSelectCaption: gallery.query.setFilter,
      onSelectFile: gallery.query.setFileFilter,
      onReset: gallery.query.resetFilters,
    }),
    [
      gallery.query.fileFilter,
      gallery.query.fileFilterCounts,
      gallery.query.filter,
      gallery.query.filterCounts,
      gallery.query.hasActiveFilters,
      gallery.query.mediaTypeFilter,
      gallery.query.mediaTypeFilterCounts,
      gallery.query.resetFilters,
      gallery.query.setFileFilter,
      gallery.query.setFilter,
      gallery.query.setMediaTypeFilter,
    ],
  );

  const quickAction = useQuickActionHost({
    folder,
    folderNotFound,
    navigateTo,
    refreshFolder: refreshFolderAndCounts,
    onCreateFolder: createFolder.openDialog,
    onDeleteFolder: deleteFolder.openDialog,
    panel: automation.actions,
    selection: selectionActions,
    selectedCount: gallery.visibleSelectedCount,
    selectionMode: selection.selectionMode,
    visibleCount: gallery.query.filteredItems.length,
    onSelectAll: gallery.handleSelectAllPaths,
    onInvertSelection: gallery.handleInvertSelection,
    sidecarSweep,
    settleAllCandidates,
    filters: quickActionFilters,
    onOpenSettings: settings.openSettings,
    onOpenShortcuts: shortcuts.openShortcuts,
  });

  return {
    mainRef,
    transitionRef,
    folder,
    loading,
    refreshing,
    error,
    folderNotFound,
    subfolders,
    filteredSubfolders,
    items,
    navigateTo,
    createFolder,
    deleteFolder,
    fileDrop,
    gallery,
    selectionActions,
    sidecarSweep,
    settleAllCandidates,
    automation,
    quickAction,
    statsDrawer,
    settings,
    shortcuts,
    duplicateResolver,
    candidateReview,
  };
}
