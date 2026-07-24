import { useCallback, useMemo, useRef, useState } from "react";
import { AppBrowseContent } from "@/app/components/AppBrowseContent";
import { AppHeader } from "@/app/components/AppHeader";
import { AppOverlays } from "@/app/components/AppOverlays";
import { useAppModals } from "@/app/hooks/useAppModals";
import { useAutomationDialogOverlays, useFolderAutomation } from "@/features/automation";
import {
  CreateFolderDialog,
  createFolder,
  useFolderChangeDetection,
  useFolderNavigation,
  useGalleryFileDrop,
} from "@/features/browse";
import {
  countResolvableIssues,
  listResolvableIssueItems,
  useBrowseCaptionSave,
  useGalleryQuery,
  useGallerySelection,
} from "@/features/gallery";
import { useJobStartConfirmation } from "@/features/jobs";
import { formatApiError } from "@/shared/api/http";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

export function AppContent() {
  const mainRef = useRef<HTMLElement>(null);
  const {
    selectionEpoch,
    syspromptOpen,
    setSyspromptOpen,
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
  } = useGallerySelection();

  const { browse, loading, refreshing, error, navigateTo, setBrowse, reloadFolder } =
    useFolderNavigation(clearSelection);

  const reloadFolderSilently = useCallback(() => reloadFolder({ silent: true }), [reloadFolder]);

  const {
    filter,
    setFilter,
    mediaTypeFilter,
    setMediaTypeFilter,
    searchQuery,
    searchRegex,
    setSearchQuery,
    setSearchRegex,
    sort,
    setSort,
    filteredItems,
    captionedCount,
    filterCounts,
    mediaTypeFilterCounts,
    filterEmptyState,
  } = useGalleryQuery(browse?.items ?? []);
  useDocumentTitle(browse?.folder, browse?.breadcrumbs ?? []);

  const subfolders = useMemo(() => browse?.subfolders ?? [], [browse?.subfolders]);
  const items = useMemo(() => browse?.items ?? [], [browse?.items]);
  const issueCount = useMemo(() => countResolvableIssues(items), [items]);
  const sysprompt = browse?.sysprompt ?? null;
  const folderNotFound = error?.kind === "folder-not-found";

  const handleCaptionSaved = useBrowseCaptionSave(setBrowse);
  const automation = useFolderAutomation(browse?.folder, reloadFolderSilently);

  const { syncBaseline } = useFolderChangeDetection(
    browse?.folder,
    browse?.fingerprint,
    reloadFolderSilently,
    {
      suspendReloads: automation.folderHasActiveJob,
      enabled: !folderNotFound,
    },
  );

  const onCaptionSaved = useCallback(
    (path: string, update: Parameters<typeof handleCaptionSaved>[1]) => {
      handleCaptionSaved(path, update);
      void syncBaseline();
    },
    [handleCaptionSaved, syncBaseline],
  );

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
    syspromptModalItem,
    onJsonEditorOpenChange,
  } = useAppModals({
    images: items,
    filteredItems,
    selectionEpoch,
    syspromptOpen,
    setSyspromptOpen,
    folder: browse?.folder,
    sysprompt,
    mainRef,
  });

  const onGalleryItemDeleted = useCallback(
    (path: string) => {
      removeGalleryItem(path);
      void reloadFolderSilently().then(() => syncBaseline());
    },
    [removeGalleryItem, reloadFolderSilently, syncBaseline],
  );

  const onGalleryItemsDeleted = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        removeGalleryItem(path);
      }
      removeSelectedPaths(paths);
      await reloadFolderSilently();
      await syncBaseline();
    },
    [removeGalleryItem, removeSelectedPaths, reloadFolderSilently, syncBaseline],
  );

  const onGalleryItemsMoved = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        removeGalleryItem(path);
      }
      removeSelectedPaths(paths);
      await reloadFolderSilently();
      await syncBaseline();
    },
    [removeGalleryItem, removeSelectedPaths, reloadFolderSilently, syncBaseline],
  );

  const jobStart = useJobStartConfirmation(
    browse?.folder,
    browse?.breadcrumbs ?? [],
    {
      strip_metadata: automation.startStripMetadataJob,
    },
    getJobPaths,
  );

  const automationDialogs = useAutomationDialogOverlays({
    folderPath: browse?.folder,
    folderLabel: jobStart.folderLabel,
    startingSetCaptions: automation.startingSetCaptions,
    startingBodyParts: automation.startingBodyParts,
    startingAutoCaption: automation.startingAutoCaption,
    startingVerifyCaptions: automation.startingVerifyCaptions,
    startingBatchRename: automation.startingBatchRename,
    itemCount: getJobPaths()?.length ?? items.length,
    startSetCaptionsJob: automation.startSetCaptionsJob,
    startBodyPartsJob: automation.startBodyPartsJob,
    startAutoCaptionJob: automation.startAutoCaptionJob,
    startVerifyCaptionsJob: automation.startVerifyCaptionsJob,
    startBatchRenameJob: automation.startBatchRenameJob,
    getJobPaths,
  });

  const handleSelectAllPaths = useCallback(() => {
    selectAllPaths(filteredItems.map((item) => item.path));
  }, [filteredItems, selectAllPaths]);

  const [issueResolverOpen, setIssueResolverOpen] = useState(false);
  const [issueResolverIndex, setIssueResolverIndex] = useState(0);
  const [issueResolverItems, setIssueResolverItems] = useState(() => listResolvableIssueItems([]));
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);

  const openIssueResolver = useCallback(() => {
    setIssueResolverItems(listResolvableIssueItems(items));
    setIssueResolverIndex(0);
    setIssueResolverOpen(true);
  }, [items]);

  const closeIssueResolver = useCallback(() => {
    setIssueResolverOpen(false);
    setIssueResolverIndex(0);
    setIssueResolverItems([]);
  }, []);

  const fileDropFolderLabel =
    browse?.breadcrumbs[browse.breadcrumbs.length - 1]?.name ?? browse?.folder ?? "this folder";

  const createFolderParentLabel = fileDropFolderLabel;

  const openCreateFolderDialog = useCallback(() => {
    if (folderNotFound || !browse?.folder) return;
    setCreateFolderError(null);
    setCreateFolderOpen(true);
  }, [browse?.folder, folderNotFound]);

  const closeCreateFolderDialog = useCallback(() => {
    if (creatingFolder) return;
    setCreateFolderOpen(false);
    setCreateFolderError(null);
  }, [creatingFolder]);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (!browse?.folder || creatingFolder) return;

      setCreatingFolder(true);
      setCreateFolderError(null);

      try {
        const created = await createFolder(browse.folder, name);
        setCreateFolderOpen(false);
        await navigateTo(created.path);
        await syncBaseline();
      } catch (error) {
        setCreateFolderError(formatApiError(error));
      } finally {
        setCreatingFolder(false);
      }
    },
    [browse?.folder, creatingFolder, navigateTo, syncBaseline],
  );

  const fileDrop = useGalleryFileDrop({
    folderPath: browse?.folder,
    enabled: Boolean(browse) && !folderNotFound && !loading,
    onImported: async () => {
      await reloadFolderSilently();
      await syncBaseline();
    },
  });

  return (
    <div className="app">
      {browse && (
        <AppHeader
          browse={browse}
          folderNotFound={folderNotFound}
          onNavigate={navigateTo}
          onCreateFolder={folderNotFound ? undefined : openCreateFolderDialog}
          toolbarProps={{
            subfolderCount: browse.subfolder_count,
            fileCount: items.length,
            captionedCount,
            statsLoading: loading && !refreshing,
            searchQuery,
            searchRegex,
            sort,
            filter,
            filterCounts,
            mediaTypeFilter,
            mediaTypeFilterCounts,
            onSearchQueryChange: (value) => {
              setSearchQuery(value);
              clearSelection();
            },
            onSearchRegexChange: (value) => {
              setSearchRegex(value);
              clearSelection();
            },
            onSortChange: (value) => {
              setSort(value);
              clearSelection();
            },
            onFilterChange: (value) => {
              setFilter(value);
              clearSelection();
            },
            onMediaTypeFilterChange: (value) => {
              setMediaTypeFilter(value);
              clearSelection();
            },
          }}
        />
      )}

      <main ref={mainRef} className="main">
        <div className="main__inner">
          <AppBrowseContent
            error={error}
            loading={loading}
            browse={browse}
            subfolders={subfolders}
            items={items}
            filteredItems={filteredItems}
            filterEmptyState={filterEmptyState}
            onNavigate={navigateTo}
            onCreateFolder={folderNotFound ? undefined : openCreateFolderDialog}
            createFolderDisabled={creatingFolder}
            onOpenGalleryItem={openGalleryItem}
            fileDropEnabled={Boolean(browse) && !folderNotFound && !loading}
            fileDropActive={fileDrop.isDragActive}
            fileDropFolderLabel={fileDropFolderLabel}
            onFileDragEnter={fileDrop.onDragEnter}
            onFileDragOver={fileDrop.onDragOver}
            onFileDragLeave={fileDrop.onDragLeave}
            onFileDrop={fileDrop.onDrop}
            selectionMode={selectionMode}
            selectedCount={selectedCount}
            selectedPaths={selectedPaths}
            onEnterSelectionMode={enterSelectionMode}
            onExitSelectionMode={exitSelectionMode}
            onSelectAllPaths={handleSelectAllPaths}
            onClearSelectedPaths={clearSelectedPaths}
            onToggleSelectedPath={toggleSelectedPath}
            onDeleteSelectedPaths={onGalleryItemsDeleted}
            onMoveSelectedPaths={onGalleryItemsMoved}
            currentFolder={browse?.folder ?? ""}
            automationPanelProps={{
              filteredItems,
              job: automation.folderJob,
              startingAutoCaption: automation.startingAutoCaption,
              startingBodyParts: automation.startingBodyParts,
              startingStripMetadata: automation.startingStripMetadata,
              startingSetCaptions: automation.startingSetCaptions,
              startingVerifyCaptions: automation.startingVerifyCaptions,
              startingBatchRename: automation.startingBatchRename,
              canStart: !automation.folderHasActiveJob,
              hasSyspromptFile: Boolean(sysprompt),
              hasSyspromptContent: sysprompt?.has_description ?? false,
              onEditSysprompt: openSysPrompt,
              onStartAutoCaption: automationDialogs.openAutoCaptionDialog,
              onStartBodyParts: automationDialogs.openBodyPartsDialog,
              onStartStripMetadata: () => jobStart.requestJobStart("strip_metadata"),
              onStartSetCaptions: automationDialogs.openSetCaptionsDialog,
              onStartVerifyCaptions: automationDialogs.openVerifyCaptionsDialog,
              onStartBatchRename: automationDialogs.openBatchRenameDialog,
              cancellingJob: automation.cancellingJob,
              onCancelJob: automation.cancelFolderJob,
              issueCount,
              onResolveIssues: issueCount > 0 ? openIssueResolver : undefined,
            }}
          />
        </div>
      </main>

      {createFolderOpen && (
        <CreateFolderDialog
          parentLabel={createFolderParentLabel}
          busy={creatingFolder}
          error={createFolderError}
          onConfirm={handleCreateFolder}
          onCancel={closeCreateFolderDialog}
        />
      )}

      <AppOverlays
        currentFolder={browse?.folder}
        onOpenFolder={navigateTo}
        onCaptionSaved={onCaptionSaved}
        gallery={{
          selectedPath,
          selectedIndex,
          modalItems,
          onClose: closeGalleryItem,
          onPrevious: goToPrevious,
          onNext: goToNext,
          onDeleted: onGalleryItemDeleted,
          onJsonEditorOpenChange,
        }}
        issueResolver={{
          open: issueResolverOpen,
          items: issueResolverItems,
          index: issueResolverIndex,
          onClose: closeIssueResolver,
          onIndexChange: setIssueResolverIndex,
        }}
        sysprompt={{
          open: syspromptOpen,
          item: syspromptModalItem,
          onClose: closeSysPrompt,
        }}
        jobStart={{
          pending: jobStart.pendingJobStart,
          folderLabel: jobStart.folderLabel,
          onConfirm: jobStart.confirmPendingJobStart,
          onCancel: jobStart.cancelPendingJobStart,
        }}
        automation={automationDialogs.dialogs}
        fileImport={{
          overwritePrompt: fileDrop.overwritePrompt,
          busy: fileDrop.importing,
          onReplaceExisting: fileDrop.confirmOverwrite,
          onCopyNewOnly: fileDrop.importNewFilesOnly,
          onCancel: fileDrop.dismissOverwritePrompt,
        }}
      />
    </div>
  );
}
