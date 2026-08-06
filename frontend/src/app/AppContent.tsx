import { AppFolderContent } from "@/app/components/AppFolderContent";
import { AppHeader } from "@/app/components/AppHeader";
import { AppOverlays } from "@/app/components/AppOverlays";
import { useAppWorkspace } from "@/app/hooks/useAppWorkspace";
import { GallerySelectionProvider } from "@/features/gallery/context/GallerySelectionContext";

export function AppContent() {
  const {
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
    fileDrop,
    gallery,
    automation,
  } = useAppWorkspace();

  const {
    query,
    clearSelection,
    selectionMode,
    selectedPaths,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectedPath,
    clearSelectedPaths,
    handleSelectAllPaths,
    openGalleryItem,
    onGalleryItemsDeleted,
    onGalleryItemsMoved,
    onGalleryItemsCopied,
  } = gallery;

  return (
    <GallerySelectionProvider
      selectionMode={selectionMode}
      selectedPaths={selectedPaths}
      selectedCount={selectedCount}
      enterSelectionMode={enterSelectionMode}
      exitSelectionMode={exitSelectionMode}
      toggleSelectedPath={toggleSelectedPath}
      clearSelectedPaths={clearSelectedPaths}
      selectAllPaths={handleSelectAllPaths}
      onDeleted={onGalleryItemsDeleted}
      onMoved={onGalleryItemsMoved}
      onCopied={onGalleryItemsCopied}
    >
      <div className="app">
        {folder && (
          <AppHeader
            folder={folder}
            folderNotFound={folderNotFound}
            refreshing={refreshing}
            onNavigate={navigateTo}
            onCreateFolder={folderNotFound ? undefined : createFolder.openDialog}
            toolbarProps={{
              subfolderCount: folder.subfolder_count,
              fileCount: items.length,
              captionedCount: query.captionedCount,
              issueCount: gallery.issueCount,
              hasCaptionBackup: folder.has_caption_backup,
              statsLoading: loading && !refreshing,
              searchQuery: query.searchQuery,
              searchRegex: query.searchRegex,
              sort: query.sort,
              filter: query.filter,
              filterCounts: query.filterCounts,
              mediaTypeFilter: query.mediaTypeFilter,
              mediaTypeFilterCounts: query.mediaTypeFilterCounts,
              onSearchQueryChange: (value) => {
                query.setSearchQuery(value);
                clearSelection();
              },
              onSearchRegexChange: (value) => {
                query.setSearchRegex(value);
                clearSelection();
              },
              onSortChange: (value) => {
                query.setSort(value);
                clearSelection();
              },
              onFilterChange: (value) => {
                query.setFilter(value);
                clearSelection();
              },
              onMediaTypeFilterChange: (value) => {
                query.setMediaTypeFilter(value);
                clearSelection();
              },
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
              items={items}
              filteredItems={query.filteredItems}
              filterEmptyState={query.filterEmptyState}
              onNavigate={navigateTo}
              onCreateFolder={folderNotFound ? undefined : createFolder.openDialog}
              createFolderDisabled={createFolder.busy}
              onOpenGalleryItem={openGalleryItem}
              automationPanelProps={automation.panelProps}
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
          currentFolder={folder?.path}
          onOpenFolder={navigateTo}
          onCaptionSaved={gallery.onCaptionSaved}
          gallery={{
            selectedPath: gallery.selectedPath,
            selectedIndex: gallery.selectedIndex,
            modalItems: gallery.modalItems,
            searchQuery: query.searchQuery,
            searchRegex: query.searchRegex,
            onClose: gallery.closeGalleryItem,
            onPrevious: gallery.goToPrevious,
            onNext: gallery.goToNext,
            onDeleted: gallery.onGalleryItemDeleted,
            onMoved: onGalleryItemsMoved,
            onCopied: onGalleryItemsCopied,
            onResolveIssue: gallery.onResolveGalleryItemIssue,
            onJsonEditorOpenChange: gallery.onJsonEditorOpenChange,
          }}
          issueResolver={gallery.issueResolver.overlay}
          sysprompt={{
            open: gallery.syspromptOpen,
            item: gallery.syspromptModalItem,
            onClose: gallery.closeSysPrompt,
          }}
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
        />
      </div>
    </GallerySelectionProvider>
  );
}
