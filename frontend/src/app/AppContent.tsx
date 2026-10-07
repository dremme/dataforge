import { ThumbnailProvider } from "@/features/gallery/context/ThumbnailProvider";
import { AppFolderContent } from "@/app/components/AppFolderContent";
import { AppHeader } from "@/app/components/AppHeader";
import { AppOverlays } from "@/app/components/AppOverlays";
import { useAppWorkspace } from "@/app/hooks/useAppWorkspace";
import { GallerySelectionProvider } from "@/features/gallery/context/GallerySelectionContext";
import { WorkspaceSidebar } from "@/app/components/WorkspaceSidebar";
import { ActiveFilters } from "@/features/gallery/components/ActiveFilters";
import { WorkspaceActions, WorkspaceActivity } from "@/app/components/WorkspaceActions";

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
    folderPicker,
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

  return (
    <ThumbnailProvider paused={Boolean(gallery.selectedPath && gallery.focusView)}>
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
            onNavigate={navigateTo}
            onOpenFolder={folderPicker.openPicker}
            onCreateFolder={createFolder.openDialog}
            onOpenSettings={settings.openSettings}
            createDisabled={!folder || folderNotFound || createFolder.busy}
          />
          {folder && (
            <AppHeader
              folder={folder}
              folderNotFound={folderNotFound}
              refreshing={refreshing}
              onNavigate={navigateTo}
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
                items={items}
                filteredItems={query.filteredItems}
                filterEmptyState={query.filterEmptyState}
                onOpenGalleryItem={openGalleryItem}
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

          <AppOverlays
            currentJobActions={automation.actions}
            currentFolder={folder?.path}
            onOpenFolder={navigateTo}
            folderPicker={folderPicker}
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
              transitionRef,
              onClose: gallery.closeGalleryItem,
              onPrevious: gallery.goToPrevious,
              onNext: gallery.goToNext,
              onGoTo: gallery.goToIndex,
              onDeleted: gallery.onGalleryItemDeleted,
              onMoved: onGalleryItemsMoved,
              onCopied: onGalleryItemsCopied,
              onResolveIssue: gallery.onResolveGalleryItemIssue,
              onReviewCandidate: candidateReview.reviewGalleryItemCandidate,
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
            settings={{ open: settings.open, onClose: settings.closeSettings }}
            shortcuts={{ open: shortcuts.open, onClose: shortcuts.closeShortcuts }}
          />
        </div>
      </GallerySelectionProvider>
    </ThumbnailProvider>
  );
}
