import type { ComponentProps } from "react";
import { AutomationPanel } from "@/features/automation/components/AutomationPanel";
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
import { iconCheck, iconFolderOpen, iconImages } from "@/shared/icons";
import type { FolderResponse, GalleryDisplayMode, GalleryItem, Subfolder } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { EmptyState } from "@/shared/ui/EmptyState";
import { SectionHeader } from "@/shared/ui/SectionHeader";
import { AppInitialLoading } from "./AppInitialLoading";

type AppFolderContentProps = {
  error: FolderError | null;
  loading: boolean;
  folder: FolderResponse | null;
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
  items,
  filteredItems,
  filterEmptyState,
  automationPanelProps,
  onNavigate,
  onCreateFolder,
  createFolderDisabled = false,
  onOpenGalleryItem,
  displayMode,
  onDisplayModeChange,
  fileDrop,
}: AppFolderContentProps) {
  const { selectionMode, visibleSelectedCount } = useGallerySelectionContext();
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
              {!folderNotFound && <AutomationPanel {...automationPanelProps} />}

              {!folderNotFound && (
                <FolderGrid
                  folders={filteredSubfolders}
                  totalCount={subfolders.length}
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
                    count={selectionMode ? visibleSelectedCount : filteredItems.length}
                    total={selectionMode ? filteredItems.length : items.length}
                    alwaysShowTotal={selectionMode}
                    countIcon={selectionMode ? iconCheck : undefined}
                    sticky
                    actions={
                      items.length > 0 ? (
                        <div className="gallery-section__actions">
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

              {folderNotFound && error && <FolderErrorState error={error} />}
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
