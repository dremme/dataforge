import { useCallback, useMemo, useRef, useState } from "react";
import { useAutomationHost } from "@/features/automation/hooks/useAutomationHost";
import { useComfyPresetsAvailable } from "@/features/automation/hooks/useComfyPresets";
import { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useCreateFolderDialog } from "@/features/folder/hooks/useCreateFolderDialog";
import { useFolderChangeDetection } from "@/features/folder/hooks/useFolderChangeDetection";
import { applyFolderDelta } from "@/features/folder/lib/applyFolderDelta";
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
import { countDuplicateGroups, countDuplicates } from "@/features/gallery/lib/duplicates";
import { countCandidates } from "@/features/gallery/lib/candidateReview";
import { useStatsDrawer } from "@/features/gallery/hooks/useStatsDrawer";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { useQuickActionHost } from "@/features/quickAction/hooks/useQuickActionHost";
import { filterSubfoldersBySearch } from "@/features/gallery/lib/query";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import type { FolderChangesResponse } from "@/shared/types";

export function useAppWorkspace() {
  const mainRef = useRef<HTMLElement>(null);
  const selection = useGallerySelection();
  const { ostrisAvailable } = useJobs();
  const comfyPresetsAvailable = useComfyPresetsAvailable();

  const { folder, loading, refreshing, error, navigateTo, setFolder, reloadFolder, scrollIntent } =
    useFolderNavigation(selection.clearSelection);

  const reloadFolderSilently = useCallback(() => reloadFolder({ silent: true }), [reloadFolder]);
  const folderNotFound = error?.kind === "folder-not-found";

  useFolderScrollPosition({
    intent: scrollIntent,
    folderPath: folder?.path,
    loading,
    hasError: Boolean(error),
  });
  const folderLabel =
    folder?.breadcrumbs[folder.breadcrumbs.length - 1]?.name ?? folder?.path ?? "this folder";

  const folderAutomation = useFolderAutomation(folder?.path, reloadFolderSilently);

  const applyDelta = useCallback(
    (delta: FolderChangesResponse) => {
      setFolder((current) => (current ? applyFolderDelta(current, delta) : current));
    },
    [setFolder],
  );

  const { syncBaseline } = useFolderChangeDetection(
    folder?.path,
    folder?.fingerprint,
    reloadFolderSilently,
    {
      suspendReloads: folderAutomation.folderHasActiveJob,
      enabled: !folderNotFound,
      applyDelta,
    },
  );

  const refreshFolder = useCallback(async () => {
    await reloadFolderSilently();
    await syncBaseline();
  }, [reloadFolderSilently, syncBaseline]);

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
  const sysprompt = folder?.sysprompt ?? null;

  useSubfolderStats(folder?.path, folder?.fingerprint, subfolders, setFolder, !folderNotFound);

  useDocumentTitle(folder?.path, folder?.breadcrumbs ?? []);

  const gallery = useGallerySession({
    selection,
    items,
    folderPath: folder?.path,
    sysprompt,
    setFolder,
    mainRef,
    refreshFolder,
    syncBaseline,
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
  const sidecarSweep = useSidecarSweep({
    folderPath: folder?.path,
    folderLabel,
    issueCount: gallery.issueCount,
    duplicateCount: duplicateFileCount,
    onSwept: refreshFolder,
  });

  const statsDrawer = useStatsDrawer();

  // Refresh on close: per-deletion reloads race the watcher's push against the frozen queue.
  const duplicateResolver = useDuplicateResolverOverlay(refreshFolder);
  const duplicateGroupCount = useMemo(() => countDuplicateGroups(items), [items]);
  const candidateCount = useMemo(() => countCandidates(items), [items]);

  const candidateReview = useCandidateReviewOverlay(refreshFolder);

  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const openFolderPicker = useCallback(() => setFolderPickerOpen(true), []);
  const closeFolderPicker = useCallback(() => setFolderPickerOpen(false), []);

  const automation = useAutomationHost({
    folder: folder?.path,
    breadcrumbs: folder?.breadcrumbs ?? [],
    items,
    filteredItems: gallery.query.filteredItems,
    sysprompt,
    hasCaptionBackup: folder?.has_caption_backup ?? false,
    ostrisAvailable,
    comfyPresetsAvailable,
    getJobPaths: gallery.getJobPaths,
    automation: folderAutomation,
    onEditSysprompt: gallery.openSysPrompt,
    issueCount: gallery.issueCount,
    onResolveIssues:
      gallery.issueCount > 0 ? () => gallery.issueResolver.openIssueResolver(items) : undefined,
    duplicateGroupCount,
    onResolveDuplicates:
      duplicateGroupCount > 0 && folder?.path
        ? () => void duplicateResolver.openDuplicateResolver(folder.path)
        : undefined,
    candidateCount,
    onReviewCandidates:
      candidateCount > 0 && folder?.path
        ? () => void candidateReview.openCandidateReview(folder.path, items)
        : undefined,
  });

  const quickAction = useQuickActionHost({
    folder,
    folderNotFound,
    navigateTo,
    refreshFolder,
    onOpenFolderPicker: openFolderPicker,
    onCreateFolder: createFolder.openDialog,
    panel: automation.panelProps,
    selection: selectionActions,
    selectedCount: gallery.visibleSelectedCount,
    selectionMode: selection.selectionMode,
    visibleCount: gallery.query.filteredItems.length,
    onSelectAll: gallery.handleSelectAllPaths,
    onInvertSelection: gallery.handleInvertSelection,
    sidecarSweep,
  });

  return {
    mainRef,
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
    folderPicker: {
      open: folderPickerOpen,
      openPicker: openFolderPicker,
      closePicker: closeFolderPicker,
    },
    fileDrop,
    gallery,
    selectionActions,
    sidecarSweep,
    automation,
    quickAction,
    statsDrawer,
    duplicateResolver,
    candidateReview,
  };
}
