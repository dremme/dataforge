import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ThumbnailProvider } from "@/features/gallery/context/ThumbnailProvider";
import { AppFolderContent } from "@/app/components/AppFolderContent";
import { AppHeader } from "@/app/components/AppHeader";
import { AppOverlays } from "@/app/components/AppOverlays";
import { useAppWorkspace } from "@/app/hooks/useAppWorkspace";
import { GallerySelectionProvider } from "@/features/gallery/context/GallerySelectionContext";
import { WorkspaceSidebar } from "@/app/components/WorkspaceSidebar";
import { ActiveFilters } from "@/features/gallery/components/ActiveFilters";
import { FolderNoteBanner } from "@/features/folder/components/FolderNoteBanner";
import { folderPathsEqual, parentFolderPath } from "@/features/folder/lib/folderPath";
import { useTaggingFolder } from "@/features/tagging/hooks/useTaggingFolder";
import { WorkspaceActions, WorkspaceActivity } from "@/app/components/WorkspaceActions";
import { VideoEditorWorkspace } from "@/features/videoEditor/components/VideoEditorWorkspace";
import { VideoExportTracker } from "@/features/videoEditor/components/VideoExportTracker";
import { VIDEO_PROJECTS_QUERY_KEY } from "@/features/videoEditor/hooks/useVideoProjectList";
import { useVideoEditorRoute } from "@/features/videoEditor/hooks/useVideoEditorRoute";
import { VideoEditorContext } from "@/features/videoEditor/context/VideoEditorContext";

/** How long an exported video may take to show up in the listing before the open gives up. */
const OPEN_EXPORT_TIMEOUT_MS = 15_000;

export function AppContent() {
  const {
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
    renameFolder,
    deleteFolder,
    fileDrop,
    gallery,
    selectionActions,
    automation,
    quickAction,
    statsDrawer,
    settings,
    shortcuts,
    duplicateResolver,
    candidateReview,
    sidecarSweep,
    settleAllCandidates,
  } = useAppWorkspace();
  const taggingFolder = useTaggingFolder();

  const {
    query,
    selectionMode,
    selectedPaths,
    visibleSelectedPaths,
    visibleSelectedCount,
    enterSelectionMode,
    exitSelectionMode,
    handleToggleSelectPath,
    handleExtendSelectionTo,
    clearSelectedPaths,
    handleSelectAllPaths,
    handleInvertSelection,
    openGalleryItem,
    onGalleryItemsDeleted,
    onGalleryItemsMoved,
    onGalleryItemsCopied,
  } = gallery;

  const queryClient = useQueryClient();
  // Drafts are not part of the folder's fingerprint, so leaving the editor re-reads them.
  const editor = useVideoEditorRoute(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: VIDEO_PROJECTS_QUERY_KEY });
    }, [queryClient]),
  );
  const editorRequest = editor.request;
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const { open: openEditor, close: closeEditor } = editor;
  const editorLauncher = useMemo(
    () => ({
      open: (path: string) => openEditor({ kind: "video", path }),
      openProject: (path: string) => openEditor({ kind: "project", path }),
      isOpen: editorRequest !== null,
    }),
    [editorRequest, openEditor],
  );

  // An export lands in the listing once the folder watcher reports it; open it then.
  const { openGalleryItem: openItem } = gallery;
  useEffect(() => {
    if (!pendingOpen) return;
    if (query.filteredItems.some((item) => item.path === pendingOpen)) {
      // Opening may start a workspace transition, so it waits for the commit.
      // oxlint-disable-next-line react-hooks/set-state-in-effect -- paired with the open
      setPendingOpen(null);
      openItem(pendingOpen);
      return;
    }
    const timer = window.setTimeout(() => setPendingOpen(null), OPEN_EXPORT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [openItem, pendingOpen, query.filteredItems]);

  // The folder change waits until the editor's entry is gone, or the folder's URL would keep it.
  const openExport = useCallback(
    (path: string) => {
      closeEditor(() => {
        const target = parentFolderPath(path);
        if (folder?.path !== target) void navigateTo(target);
        setPendingOpen(path);
      });
    },
    [closeEditor, folder, navigateTo],
  );

  return (
    <ThumbnailProvider
      paused={Boolean(gallery.selectedPath && (gallery.focusView || gallery.editExpanded))}
    >
      <GallerySelectionProvider
        selectionMode={selectionMode}
        inspectedPath={gallery.selectedPath}
        selectedPaths={selectedPaths}
        visibleSelectedPaths={visibleSelectedPaths}
        visibleSelectedCount={visibleSelectedCount}
        enterSelectionMode={enterSelectionMode}
        exitSelectionMode={exitSelectionMode}
        toggleSelectedPath={handleToggleSelectPath}
        extendSelectionTo={handleExtendSelectionTo}
        clearSelectedPaths={clearSelectedPaths}
        selectAllPaths={handleSelectAllPaths}
        invertSelectedPaths={handleInvertSelection}
        onDeleted={onGalleryItemsDeleted}
        onMoved={onGalleryItemsMoved}
        onCopied={onGalleryItemsCopied}
        actions={selectionActions}
      >
        <div className="app">
          <WorkspaceSidebar
            currentFolder={folder?.path}
            note={folder?.note}
            hasInstructions={Boolean(folder?.has_sysprompt || folder?.has_caption_rules)}
            onEditInstructions={gallery.openSysPrompt}
            onNavigate={navigateTo}
            onCreateFolder={createFolder.openDialog}
            onOpenSettings={settings.openSettings}
            onOpenVideoEditor={() => folder && openEditor({ kind: "new", path: folder.path })}
            videoEditorDisabled={!folder || folderNotFound}
            createDisabled={!folder || folderNotFound || createFolder.busy}
          />
          {folder && (
            <AppHeader
              folder={folder}
              folderNotFound={folderNotFound}
              refreshing={refreshing}
              tagging={taggingFolder !== null && folderPathsEqual(folder.path, taggingFolder)}
              onNavigate={navigateTo}
              note={
                folder.note && !folderNotFound ? (
                  <FolderNoteBanner folderPath={folder.path} note={folder.note} />
                ) : undefined
              }
              activity={<WorkspaceActivity panel={automation.actions} />}
              toolbarProps={{
                actions: <WorkspaceActions panel={automation.actions} />,
                subfolderCount: folder.subfolder_count,
                fileCount: items.length,
                captionedCount: query.captionedCount,
                issueCount: gallery.issueCount,
                hasSysprompt: folder.has_sysprompt,
                hasCaptionRules: folder.has_caption_rules,
                hasCaptionBackup: folder.has_caption_backup,
                statsLoading: loading && !refreshing,
                searchQuery: query.searchQuery,
                searchRegex: query.searchRegex,
                searchNames: query.searchNames,
                sort: query.sort,
                filter: query.filter,
                filterCounts: query.filterCounts,
                mediaTypeFilter: query.mediaTypeFilter,
                mediaTypeFilterCounts: query.mediaTypeFilterCounts,
                fileFilter: query.fileFilter,
                fileFilterCounts: query.fileFilterCounts,
                statsOpen: statsDrawer.statsOpen,
                onToggleStats: statsDrawer.toggleStats,
                onSearchQueryChange: query.setSearchQuery,
                onSearchRegexChange: query.setSearchRegex,
                onSearchNamesChange: query.setSearchNames,
                onSortChange: query.setSort,
                onFilterChange: query.setFilter,
                onMediaTypeFilterChange: query.setMediaTypeFilter,
                onFileFilterChange: query.setFileFilter,
              }}
            />
          )}

          <main ref={mainRef} className="main">
            <div className="main__inner">
              <AppFolderContent
                error={error}
                loading={loading}
                folder={folder}
                subfolders={subfolders}
                filteredSubfolders={filteredSubfolders}
                onNavigate={navigateTo}
                onRenameFolder={renameFolder.openDialog}
                onDeleteFolder={deleteFolder.openDialog}
                items={items}
                filteredItems={query.filteredItems}
                filterEmptyState={query.filterEmptyState}
                onOpenGalleryItem={openGalleryItem}
                onOpenVideoProject={editorLauncher.openProject}
                searchQuery={query.searchQuery}
                displayMode={gallery.displayMode}
                onDisplayModeChange={gallery.setDisplayMode}
                activeFilters={
                  <ActiveFilters
                    filter={query.filter}
                    mediaTypeFilter={query.mediaTypeFilter}
                    fileFilter={query.fileFilter}
                    onFilterChange={query.setFilter}
                    onMediaTypeFilterChange={query.setMediaTypeFilter}
                    onFileFilterChange={query.setFileFilter}
                  />
                }
                fileDrop={{
                  enabled: Boolean(folder) && !folderNotFound && !loading,
                  active: fileDrop.isDragActive,
                  folderLabel:
                    folder?.breadcrumbs[folder.breadcrumbs.length - 1]?.name ??
                    folder?.path ??
                    "this folder",
                  onDragEnter: fileDrop.onDragEnter,
                  onDragOver: fileDrop.onDragOver,
                  onDragLeave: fileDrop.onDragLeave,
                  onDrop: fileDrop.onDrop,
                }}
              />
            </div>
          </main>

          <VideoEditorContext value={editorLauncher}>
            <AppOverlays
              currentJobActions={automation.actions}
              currentFolder={folder?.path}
              onOpenFolder={navigateTo}
              quickAction={quickAction}
              selectionActions={selectionActions.overlay}
              sidecarSweep={sidecarSweep.overlay}
              settleAllCandidates={settleAllCandidates.overlay}
              onCaptionSaved={gallery.onCaptionSaved}
              gallery={{
                selectedPath: gallery.selectedPath,
                selectedIndex: gallery.selectedIndex,
                modalItems: gallery.modalItems,
                searchQuery: query.searchQuery,
                searchRegex: query.searchRegex,
                hasCaptionBackup: folder?.has_caption_backup ?? false,
                focusView: gallery.focusView,
                onFocusViewChange: gallery.setFocusView,
                onEditExpandedChange: gallery.setEditExpanded,
                transitionRef,
                onClose: gallery.closeGalleryItem,
                onPrevious: gallery.goToPrevious,
                onNext: gallery.goToNext,
                onGoTo: gallery.goToIndex,
                onDeleted: gallery.onGalleryItemDeleted,
                onRenamed: gallery.onGalleryItemRenamed,
                onMoved: onGalleryItemsMoved,
                onCopied: onGalleryItemsCopied,
                onResolveIssue: gallery.onResolveGalleryItemIssue,
                onReviewCandidate: candidateReview.reviewGalleryItemCandidate,
                onResolveDuplicate: duplicateResolver.resolveGalleryItemDuplicate,
                suspended: editorRequest !== null,
              }}
              issueResolver={gallery.issueResolver.overlay}
              instructions={{
                open: gallery.instructionsOpen,
                folderPath: folder?.path,
                onClose: gallery.closeInstructions,
                onSaved: gallery.onInstructionsSaved,
              }}
              stats={{
                open: statsDrawer.statsOpen,
                items,
                onClose: statsDrawer.closeStats,
                onSearchWord: (word) => {
                  query.setSearchNames(false);
                  query.setSearchQuery(word);
                  statsDrawer.closeStats();
                },
              }}
              duplicateResolver={duplicateResolver.overlay}
              candidateReview={candidateReview.overlay}
              jobStart={automation.jobStartConfirm}
              automation={automation.dialogs}
              fileImport={{
                overwritePrompt: fileDrop.overwritePrompt,
                busy: fileDrop.importing,
                onReplaceExisting: fileDrop.confirmOverwrite,
                onCopyNewOnly: fileDrop.importNewFilesOnly,
                onCancel: fileDrop.dismissOverwritePrompt,
              }}
              createFolder={createFolder.overlay}
              renameFolder={renameFolder.overlay}
              deleteFolder={deleteFolder.overlay}
              settings={{ open: settings.open, onClose: settings.closeSettings }}
              shortcuts={{ open: shortcuts.open, onClose: shortcuts.closeShortcuts }}
            />
          </VideoEditorContext>
          {editorRequest && (
            <VideoEditorWorkspace
              request={editorRequest}
              items={items}
              onExit={() => closeEditor()}
              onOpenInGallery={openExport}
              onRelocate={editor.relocate}
            />
          )}
          <VideoExportTracker hidden={editorRequest !== null} onOpen={openExport} />
        </div>
      </GallerySelectionProvider>
    </ThumbnailProvider>
  );
}
