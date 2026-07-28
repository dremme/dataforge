import type { ComponentProps } from "react";
import { AutomationPanel } from "@/features/automation/components/AutomationPanel";
import { BrowseErrorState } from "@/features/browse/components/BrowseErrorState";
import { FolderBrowseLoading } from "@/features/browse/components/FolderBrowseLoading";
import { FolderGrid } from "@/features/browse/components/FolderGrid";
import { Gallery } from "@/features/gallery/components/Gallery";
import { GalleryFileDropOverlay } from "@/features/gallery/components/GalleryFileDropOverlay";
import { GallerySelectionControls } from "@/features/gallery/components/GallerySelectionControls";
import type { FilterEmptyState } from "@/features/gallery/lib/filters";
import type { BrowseError } from "@/shared/api/http";
import { iconFolderOpen, iconImages } from "@/shared/icons";
import type { BrowseResponse, GalleryItem, Subfolder } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { EmptyState } from "@/shared/ui/EmptyState";
import { SectionHeader } from "@/shared/ui/SectionHeader";
import { AppInitialLoading } from "./AppInitialLoading";

type AppBrowseContentProps = {
  error: BrowseError | null;
  loading: boolean;
  browse: BrowseResponse | null;
  subfolders: Subfolder[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  filterEmptyState: FilterEmptyState;
  automationPanelProps: ComponentProps<typeof AutomationPanel>;
  onNavigate: (path?: string) => void;
  onCreateFolder?: () => void;
  createFolderDisabled?: boolean;
  onOpenGalleryItem: (path: string) => void;
  fileDropEnabled?: boolean;
  fileDropActive?: boolean;
  fileDropFolderLabel?: string;
  onFileDragEnter?: (event: React.DragEvent) => void;
  onFileDragOver?: (event: React.DragEvent) => void;
  onFileDragLeave?: (event: React.DragEvent) => void;
  onFileDrop?: (event: React.DragEvent) => void;
  selectionMode?: boolean;
  selectedCount?: number;
  selectedPaths?: ReadonlySet<string>;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onSelectAllPaths: () => void;
  onClearSelectedPaths: () => void;
  onToggleSelectedPath: (path: string) => void;
  onDeleteSelectedPaths: (paths: string[]) => void | Promise<void>;
  onMoveSelectedPaths: (paths: string[]) => void | Promise<void>;
  currentFolder?: string;
};

export function AppBrowseContent({
  error,
  loading,
  browse,
  subfolders,
  items,
  filteredItems,
  filterEmptyState,
  automationPanelProps,
  onNavigate,
  onCreateFolder,
  createFolderDisabled = false,
  onOpenGalleryItem,
  fileDropEnabled = false,
  fileDropActive = false,
  fileDropFolderLabel = "",
  onFileDragEnter,
  onFileDragOver,
  onFileDragLeave,
  onFileDrop,
  selectionMode = false,
  selectedCount = 0,
  selectedPaths,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectAllPaths,
  onClearSelectedPaths,
  onToggleSelectedPath,
  onDeleteSelectedPaths,
  onMoveSelectedPaths,
  currentFolder = "",
}: AppBrowseContentProps) {
  const folderNotFound = error?.kind === "folder-not-found";
  const globalError = error && !folderNotFound ? error : null;
  const showEmptyFolder = !error && items.length === 0;
  const showFilterEmptyState = !error && filteredItems.length === 0 && !showEmptyFolder;
  const emptyFolderDescription =
    subfolders.length > 0
      ? "This folder has no supported image/video files. Drop compatible files here to import them."
      : "This folder has no subfolders or supported image/video files. Drop compatible files here to import them.";

  return (
    <>
      {globalError && <BrowseErrorState error={globalError} />}

      {loading && !browse && <AppInitialLoading />}

      {browse &&
        (loading ? (
          <FolderBrowseLoading />
        ) : (
          <div
            className={classNames(
              "gallery-drop-zone",
              fileDropActive && "gallery-drop-zone--active",
            )}
            onDragEnter={fileDropEnabled ? onFileDragEnter : undefined}
            onDragOver={fileDropEnabled ? onFileDragOver : undefined}
            onDragLeave={fileDropEnabled ? onFileDragLeave : undefined}
            onDrop={fileDropEnabled ? onFileDrop : undefined}
          >
            <div className="gallery-drop-zone__content">
              {!folderNotFound && <AutomationPanel {...automationPanelProps} />}

              {!folderNotFound && (
                <FolderGrid
                  folders={subfolders}
                  onOpen={onNavigate}
                  onCreateFolder={onCreateFolder}
                  createFolderDisabled={createFolderDisabled}
                />
              )}

              {!folderNotFound && (
                <section className="gallery-section" aria-label="Media">
                  {filteredItems.length > 0 && (
                    <SectionHeader
                      section="gallery"
                      icon={iconImages}
                      title="Media"
                      count={selectionMode ? selectedCount : filteredItems.length}
                      actions={
                        onEnterSelectionMode ? (
                          <GallerySelectionControls
                            currentFolder={currentFolder}
                            totalCount={filteredItems.length}
                            selectionMode={selectionMode}
                            selectedCount={selectedCount}
                            selectedPaths={selectedPaths ?? new Set()}
                            onEnterSelectionMode={onEnterSelectionMode}
                            onExitSelectionMode={onExitSelectionMode}
                            onSelectAll={onSelectAllPaths}
                            onClearSelection={onClearSelectedPaths}
                            onDeleted={onDeleteSelectedPaths}
                            onMoved={onMoveSelectedPaths}
                          />
                        ) : undefined
                      }
                    />
                  )}

                  {filteredItems.length > 0 ? (
                    <Gallery
                      items={filteredItems}
                      onSelect={onOpenGalleryItem}
                      selectionMode={selectionMode}
                      selectedPaths={selectedPaths}
                      onToggleSelect={onToggleSelectedPath}
                    />
                  ) : showEmptyFolder ? (
                    <EmptyState
                      icon={iconFolderOpen}
                      title="Empty folder"
                      description={emptyFolderDescription}
                      variant="muted"
                    />
                  ) : showFilterEmptyState ? (
                    <EmptyState
                      icon={filterEmptyState.icon}
                      title={filterEmptyState.title}
                      description={filterEmptyState.description}
                      variant={filterEmptyState.variant}
                    />
                  ) : null}
                </section>
              )}

              {folderNotFound && error && <BrowseErrorState error={error} />}
            </div>

            {fileDropEnabled && (
              <GalleryFileDropOverlay visible={fileDropActive} folderLabel={fileDropFolderLabel} />
            )}
          </div>
        ))}
    </>
  );
}
