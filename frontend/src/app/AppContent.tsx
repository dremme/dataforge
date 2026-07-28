import { AppBrowseContent } from "@/app/components/AppBrowseContent";
import { AppHeader } from "@/app/components/AppHeader";
import { AppOverlays } from "@/app/components/AppOverlays";
import { useAppWorkspace } from "@/app/hooks/useAppWorkspace";

export function AppContent() {
  const {
    mainRef,
    browse,
    loading,
    refreshing,
    error,
    folderNotFound,
    subfolders,
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
  } = gallery;

  return (
    <div className="app">
      {browse && (
        <AppHeader
          browse={browse}
          folderNotFound={folderNotFound}
          onNavigate={navigateTo}
          onCreateFolder={folderNotFound ? undefined : createFolder.openDialog}
          toolbarProps={{
            subfolderCount: browse.subfolder_count,
            fileCount: items.length,
            captionedCount: query.captionedCount,
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
          <AppBrowseContent
            error={error}
            loading={loading}
            browse={browse}
            subfolders={subfolders}
            items={items}
            filteredItems={query.filteredItems}
            filterEmptyState={query.filterEmptyState}
            onNavigate={navigateTo}
            onCreateFolder={folderNotFound ? undefined : createFolder.openDialog}
            createFolderDisabled={createFolder.busy}
            onOpenGalleryItem={openGalleryItem}
            fileDropEnabled={Boolean(browse) && !folderNotFound && !loading}
            fileDropActive={fileDrop.isDragActive}
            fileDropFolderLabel={
              browse?.breadcrumbs[browse.breadcrumbs.length - 1]?.name ??
              browse?.folder ??
              "this folder"
            }
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
            automationPanelProps={automation.panelProps}
          />
        </div>
      </main>

      <AppOverlays
        currentFolder={browse?.folder}
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
  );
}
