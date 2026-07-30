import type { ComponentProps } from "react";
import { AutomationPanel } from "@/features/automation/components/AutomationPanel";
import { BrowseErrorState } from "@/features/browse/components/BrowseErrorState";
import { FolderBrowseLoading } from "@/features/browse/components/FolderBrowseLoading";
import { FolderGrid } from "@/features/browse/components/FolderGrid";
import { Gallery } from "@/features/gallery/components/Gallery";
import { GalleryFileDropOverlay } from "@/features/gallery/components/GalleryFileDropOverlay";
import { GallerySelectionControls } from "@/features/gallery/components/GallerySelectionControls";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
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
  filteredSubfolders: Subfolder[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  filterEmptyState: FilterEmptyState;
  automationPanelProps: ComponentProps<typeof AutomationPanel>;
  onNavigate: (path?: string) => void;
  onCreateFolder?: () => void;
  createFolderDisabled?: boolean;
  onOpenGalleryItem: (path: string) => void;
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

export function AppBrowseContent({
  error,
  loading,
  browse,
  subfolders,
  filteredSubfolders,
  items,
  filteredItems,
  filterEmptyState,
  automationPanelProps,
  onNavigate,
  onCreateFolder,
  createFolderDisabled = false,
  onOpenGalleryItem,
  fileDrop,
}: AppBrowseContentProps) {
  const { selectionMode, selectedCount } = useGallerySelectionContext();
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
              fileDrop.active && "gallery-drop-zone--active",
            )}
            onDragEnter={fileDrop.enabled ? fileDrop.onDragEnter : undefined}
            onDragOver={fileDrop.enabled ? fileDrop.onDragOver : undefined}
            onDragLeave={fileDrop.enabled ? fileDrop.onDragLeave : undefined}
            onDrop={fileDrop.enabled ? fileDrop.onDrop : undefined}
          >
            <div className="gallery-drop-zone__content">
              {!folderNotFound && <AutomationPanel {...automationPanelProps} />}

              {!folderNotFound && (
                <FolderGrid
                  folders={filteredSubfolders}
                  totalCount={subfolders.length}
                  hasCaptionBackup={browse.has_caption_backup}
                  onOpen={onNavigate}
                  onCreateFolder={onCreateFolder}
                  createFolderDisabled={createFolderDisabled}
                />
              )}

              {!folderNotFound && (
                <section className="gallery-section" aria-label="Media">
                  <SectionHeader
                    section="gallery"
                    icon={iconImages}
                    title="Media"
                    count={selectionMode ? selectedCount : filteredItems.length}
                    // Selection mode counts the selection against what is visible;
                    // browse mode counts the visible media against the whole folder.
                    total={selectionMode ? filteredItems.length : items.length}
                    alwaysShowTotal={selectionMode}
                    actions={
                      // Nothing to select once the filters empty the grid.
                      filteredItems.length > 0 ? (
                        <GallerySelectionControls
                          currentFolder={browse.folder}
                          totalCount={filteredItems.length}
                        />
                      ) : undefined
                    }
                  />

                  {filteredItems.length > 0 ? (
                    <Gallery items={filteredItems} onSelect={onOpenGalleryItem} />
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
