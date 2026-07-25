import { useCallback, useEffect, useState } from "react";
import {
  deleteSelectedMedia,
  moveSelectedMedia,
  previewMediaMove,
} from "@/features/gallery/api/media";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import { iconFolderInput, iconLoader2, iconTrash2 } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/browse/components/FileImportOverwriteDialog";
import { FolderPickerModal } from "@/features/browse/components/FolderPickerModal";
import { Icon } from "@/shared/ui/Icon";

function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

interface GallerySelectionControlsProps {
  currentFolder: string;
  totalCount: number;
  selectionMode: boolean;
  selectedCount: number;
  selectedPaths: ReadonlySet<string>;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
}

export function GallerySelectionControls({
  currentFolder,
  totalCount,
  selectionMode,
  selectedCount,
  selectedPaths,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectAll,
  onClearSelection,
  onDeleted,
  onMoved,
}: GallerySelectionControlsProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moveOverwriteOpen, setMoveOverwriteOpen] = useState(false);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [moveConflicts, setMoveConflicts] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const notify = useNotify();

  const busy = deleting || moving;

  const openDeleteConfirm = useCallback(() => {
    if (busy || selectedCount === 0) return;
    setDeleteConfirmOpen(true);
  }, [busy, selectedCount]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  const openMovePicker = useCallback(() => {
    if (busy || selectedCount === 0) return;
    setMovePickerOpen(true);
  }, [busy, selectedCount]);

  const closeMovePicker = useCallback(() => {
    if (moving) return;
    setMovePickerOpen(false);
  }, [moving]);

  const closeMoveOverwrite = useCallback(() => {
    if (moving) return;
    setMoveOverwriteOpen(false);
    setMoveConflicts([]);
    setMoveDestination(null);
  }, [moving]);

  useEffect(() => {
    if (!selectionMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (getScrollLockDepth() > 0) {
        return;
      }

      event.preventDefault();
      onExitSelectionMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExitSelectionMode, selectionMode]);

  const confirmDelete = useCallback(async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0 || deleting) return;

    setDeleting(true);

    try {
      const { succeeded } = await deleteSelectedMedia(paths);

      if (succeeded.length > 0) {
        await onDeleted(succeeded);
      }

      setDeleteConfirmOpen(false);

      if (succeeded.length === totalCount) {
        onExitSelectionMode();
      }
    } finally {
      setDeleting(false);
    }
  }, [totalCount, deleting, onDeleted, onExitSelectionMode, selectedPaths]);

  const executeMove = useCallback(
    async (destinationFolder: string, overwrite: boolean) => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0 || moving) return;

      setMoving(true);

      try {
        const { succeeded } = await moveSelectedMedia(destinationFolder, paths, overwrite);

        if (succeeded.length > 0) {
          await onMoved(succeeded);
        }

        setMovePickerOpen(false);
        setMoveOverwriteOpen(false);
        setMoveConflicts([]);
        setMoveDestination(null);

        if (succeeded.length === totalCount) {
          onExitSelectionMode();
        }
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        setMoving(false);
      }
    },
    [moving, notify, onExitSelectionMode, onMoved, selectedPaths, totalCount],
  );

  const handleDestinationSelected = useCallback(
    async (destinationFolder: string) => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0 || moving) return;

      setMoveDestination(destinationFolder);
      setMoving(true);

      try {
        const preview = await previewMediaMove(destinationFolder, paths);
        setMovePickerOpen(false);

        if (preview.movable.length === 0 && preview.conflicts.length === 0) {
          notify({
            variant: "warning",
            message: "No selected files can be moved to that folder.",
          });
          return;
        }

        if (preview.conflicts.length > 0) {
          setMoveConflicts(preview.conflicts);
          setMoveOverwriteOpen(true);
          return;
        }

        await executeMove(destinationFolder, false);
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        setMoving(false);
      }
    },
    [executeMove, moving, notify, selectedPaths],
  );

  if (!selectionMode) {
    return (
      <div className="gallery-controls">
        <button type="button" className="gallery-controls__btn" onClick={onEnterSelectionMode}>
          Select
        </button>
      </div>
    );
  }

  const deleteDescription =
    selectedCount === 1 ? (
      <span>
        This will permanently delete <strong>{pathBaseName(Array.from(selectedPaths)[0])}</strong>{" "}
        and any matching caption sidecars (.txt/.json) in this folder.
      </span>
    ) : (
      <span>
        This will permanently delete <strong>{selectedCount} selected files</strong> and any
        matching caption sidecars (.txt/.json) in this folder.
      </span>
    );

  return (
    <>
      <div className="gallery-controls">
        <button
          type="button"
          className="gallery-controls__btn gallery-controls__btn--accent"
          onClick={onExitSelectionMode}
          disabled={busy}
          aria-label="Exit selection mode"
        >
          Done
        </button>
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={onSelectAll}
          disabled={busy || selectedCount === totalCount}
        >
          All
        </button>
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={onClearSelection}
          disabled={busy || selectedCount === 0}
        >
          None
        </button>
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={openMovePicker}
          disabled={selectedCount === 0 || busy}
          aria-busy={moving || undefined}
        >
          {moving ? (
            <>
              <Icon icon={iconLoader2} spin className="gallery-controls__btn-icon" />
              Moving...
            </>
          ) : (
            <>
              <Icon icon={iconFolderInput} className="gallery-controls__btn-icon" />
              Move
            </>
          )}
        </button>
        <button
          type="button"
          className="gallery-controls__btn gallery-controls__btn--danger"
          onClick={openDeleteConfirm}
          disabled={selectedCount === 0 || busy}
          aria-busy={deleting || undefined}
        >
          {deleting ? (
            <>
              <Icon icon={iconLoader2} spin className="gallery-controls__btn-icon" />
              Deleting...
            </>
          ) : (
            <>
              <Icon icon={iconTrash2} className="gallery-controls__btn-icon" />
              Delete
            </>
          )}
        </button>
      </div>

      {movePickerOpen && (
        <FolderPickerModal
          currentFolder={currentFolder}
          title="Move to folder"
          submitLabel="Move"
          disabledFolder={currentFolder}
          onClose={closeMovePicker}
          onOpenFolder={(path) => {
            void handleDestinationSelected(path);
          }}
        />
      )}

      {moveOverwriteOpen && moveDestination && (
        <FileImportOverwriteDialog
          conflicts={moveConflicts}
          busy={moving}
          descriptionSuffix="Choose whether to replace them or move only new files."
          onReplaceExisting={() => {
            void executeMove(moveDestination, true);
          }}
          onCopyNewOnly={() => {
            void executeMove(moveDestination, false);
          }}
          onCancel={closeMoveOverwrite}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={selectedCount === 1 ? "Delete file?" : "Delete selected files?"}
          description={deleteDescription}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          confirmVariant="danger"
          busy={deleting}
          onConfirm={() => {
            void confirmDelete();
          }}
          onCancel={cancelDeleteConfirm}
        />
      )}
    </>
  );
}
