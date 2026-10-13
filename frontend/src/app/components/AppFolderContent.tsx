import type { ReactNode } from "react";
import { FolderErrorState } from "@/features/folder/components/FolderErrorState";
import { FolderLoadingState } from "@/features/folder/components/FolderLoadingState";
import { FolderGrid } from "@/features/folder/components/FolderGrid";
import { Gallery } from "@/features/gallery/components/Gallery";
import { GalleryDisplayMenu } from "@/features/gallery/components/GalleryDisplayMenu";
import { GalleryFileDropOverlay } from "@/features/gallery/components/GalleryFileDropOverlay";
import { GallerySelectionControls } from "@/features/gallery/components/GallerySelectionControls";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import type { FilterEmptyState } from "@/features/gallery/lib/filters";
import type { FolderError } from "@/shared/api/http";
import { iconCheck, iconFolderOpen, iconImages, iconTrash2 } from "@/shared/icons";
import { useUiSettings } from "@/shared/preferences/uiPreferences";
import type { FolderResponse, GalleryDisplayMode, GalleryItem, Subfolder } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";
import { VideoProjectGrid } from "@/features/videoEditor/components/VideoProjectGrid";
import { AppInitialLoading } from "./AppInitialLoading";

type AppFolderContentProps = {
  error: FolderError | null;
  loading: boolean;
  folder: FolderResponse | null;
  subfolders: Subfolder[];
  filteredSubfolders: Subfolder[];
  onNavigate: (path: string) => void;
  /** Set only while the open folder has no media and no subfolders. */
  onDeleteFolder?: () => void;
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  filterEmptyState: FilterEmptyState;
  /** The search and filter summary, shown at the start of the Media header actions. */
  activeFilters?: ReactNode;
  onOpenGalleryItem: (path: string) => void;
  /** Opens a saved editor draft; the drafts section is left out without it. */
  onOpenVideoProject?: (projectPath: string) => void;
  searchQuery?: string;
  displayMode: GalleryDisplayMode;
  onDisplayModeChange: (value: GalleryDisplayMode) => void;
  fileDrop: FileDropState;
};

type FileDropState = {
  enabled: boolean;
  active: boolean;
  folderLabel: string;
  onDragEnter: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
};

export function AppFolderContent({
  error,
  loading,
  folder,
  subfolders,
  filteredSubfolders,
  onNavigate,
  onDeleteFolder,
  items,
  filteredItems,
  filterEmptyState,
  activeFilters,
  onOpenGalleryItem,
  onOpenVideoProject,
  searchQuery = "",
  displayMode,
  onDisplayModeChange,
  fileDrop,
}: AppFolderContentProps) {
  const { selectionMode, visibleSelectedCount } = useGallerySelectionContext();
  const { galleryCards } = useUiSettings();
  const folderNotFound = error?.kind === "folder-not-found";
  const globalError = error?.kind === "other" ? error : null;
  const showEmptyFolder = !error && items.length === 0;
  const showFilterEmptyState = !error && filteredItems.length === 0 && !showEmptyFolder;
  const emptyFolderDescription =
    subfolders.length > 0
      ? "This folder has no supported image/video files. Drop compatible files here to import them."
      : "This folder has no subfolders or supported image/video files. Drop compatible files here to import them.";

  return (
    <>
      {globalError && <FolderErrorState error={globalError} />}

      {loading && !folder && <AppInitialLoading />}

      {folder &&
        (loading ? (
          <FolderLoadingState />
        ) : (
          <div
            className={classNames(
              "gallery-drop-zone",
              fileDrop.active && "gallery-drop-zone--active",
            )}
            onDragEnter={fileDrop.enabled ? fileDrop.onDragEnter : undefined}
            onDragOver={fileDrop.enabled ? fileDrop.onDragOver : undefined}
            onDragLeave={fileDrop.enabled ? fileDrop.onDragLeave : undefined}
            onDrop={fileDrop.enabled ? fileDrop.onDrop : undefined}
          >
            <div className="gallery-drop-zone__content">
              {!folderNotFound && subfolders.length > 0 && (
                <FolderGrid
                  key={folder.path}
                  folderPath={folder.path}
                  folders={filteredSubfolders}
                  totalCount={subfolders.length}
                  onOpen={onNavigate}
                />
              )}
              {!folderNotFound && onOpenVideoProject && (
                <VideoProjectGrid
                  folderPath={folder.path}
                  fingerprint={folder.fingerprint}
                  searchQuery={searchQuery}
                  onOpen={onOpenVideoProject}
                />
              )}
              {!folderNotFound && (
                <section className="gallery-section" aria-label="Media">
                  <SectionHeader
                    section="gallery"
                    icon={iconImages}
                    title="Media"
                    count={selectionMode ? visibleSelectedCount : filteredItems.length}
                    total={selectionMode ? filteredItems.length : items.length}
                    alwaysShowTotal={selectionMode}
                    countIcon={selectionMode ? iconCheck : undefined}
                    sticky
                    actions={
                      items.length > 0 ? (
                        <div className="gallery-section__actions">
                          {activeFilters}
                          {filteredItems.length > 0 && (
                            <GallerySelectionControls totalCount={filteredItems.length} />
                          )}
                          <GalleryDisplayMenu value={displayMode} onChange={onDisplayModeChange} />
                        </div>
                      ) : undefined
                    }
                  />

                  {filteredItems.length > 0 ? (
                    <Gallery
                      items={filteredItems}
                      onSelect={onOpenGalleryItem}
                      displayMode={displayMode}
                      cardOptions={galleryCards}
                    />
                  ) : showEmptyFolder ? (
                    <EmptyState
                      icon={iconFolderOpen}
                      title="Empty folder"
                      description={emptyFolderDescription}
                      variant="muted"
                      action={
                        onDeleteFolder && (
                          <button
                            type="button"
                            className="workspace-button"
                            onClick={onDeleteFolder}
                          >
                            <Icon icon={iconTrash2} />
                            Delete folder
                          </button>
                        )
                      }
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

              {error?.kind === "folder-not-found" && <FolderErrorState error={error} />}
            </div>

            {fileDrop.enabled && (
              <GalleryFileDropOverlay
                visible={fileDrop.active}
                folderLabel={fileDrop.folderLabel}
              />
            )}
          </div>
        ))}
    </>
  );
}
