import { useCallback, useEffect, useState } from "react";
import {
  deleteSelectedMedia,
  moveSelectedMedia,
  previewMediaMove,
} from "@/features/gallery/api/media";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import { iconFolderInput, iconLoader2, iconTrash2 } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/browse/components/FileImportOverwriteDialog";
import { MoveMediaDialog } from "@/features/gallery/components/MoveMediaDialog";
import { Icon } from "@/shared/ui/Icon";

function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Names the first casualty and the count, since a batch can fail one file at a time. */
function failureMessage(
  verb: string,
  failed: ReadonlyArray<{ path: string; error: unknown }>,
): string {
  const [first] = failed;
  // Moves carry the backend's `detail` string; deletes carry the thrown request error.
  const reason = typeof first.error === "string" ? first.error : formatApiError(first.error);

  if (failed.length === 1) {
    return `Could not ${verb} ${pathBaseName(first.path)}: ${reason}`;
  }

  return `Could not ${verb} ${failed.length} files. ${pathBaseName(first.path)}: ${reason}`;
}

interface GallerySelectionControlsProps {
  /** Folder the selected media currently lives in — the move dialog's origin. */
  currentFolder: string;
  /** Items currently visible under the active filters, for "select all". */
  totalCount: number;
}

export function GallerySelectionControls({
  currentFolder,
  totalCount,
}: GallerySelectionControlsProps) {
  const {
    selectionMode,
    selectedCount,
    selectedPaths,
    enterSelectionMode,
    exitSelectionMode,
    selectAllPaths,
    clearSelectedPaths,
    onDeleted,
    onMoved,
  } = useGallerySelectionContext();
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
      exitSelectionMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exitSelectionMode, selectionMode]);

  const confirmDelete = useCallback(async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0 || deleting) return;

    setDeleting(true);

    try {
      const { succeeded, failed } = await deleteSelectedMedia(paths);

      if (succeeded.length > 0) {
        await onDeleted(succeeded);
      }

      setDeleteConfirmOpen(false);

      // Per-file rejections come back in the result rather than as a thrown error.
      if (failed.length > 0) {
        notify({ variant: "danger", message: failureMessage("delete", failed) });
      }

      if (succeeded.length === totalCount) {
        exitSelectionMode();
      }
    } finally {
      setDeleting(false);
    }
  }, [totalCount, deleting, notify, onDeleted, exitSelectionMode, selectedPaths]);

  const executeMove = useCallback(
    async (destinationFolder: string, overwrite: boolean) => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0 || moving) return;

      setMoving(true);

      try {
        const { succeeded, failed } = await moveSelectedMedia(destinationFolder, paths, overwrite);

        if (succeeded.length > 0) {
          await onMoved(succeeded);
        }

        setMovePickerOpen(false);
        setMoveOverwriteOpen(false);
        setMoveConflicts([]);
        setMoveDestination(null);

        // The backend reports per-file failures in its 200 response, so nothing throws here.
        if (failed.length > 0) {
          notify({ variant: "danger", message: failureMessage("move", failed) });
        }

        if (succeeded.length === totalCount) {
          exitSelectionMode();
        }
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        setMoving(false);
      }
    },
    [moving, notify, exitSelectionMode, onMoved, selectedPaths, totalCount],
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
        <button type="button" className="gallery-controls__btn" onClick={enterSelectionMode}>
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
          onClick={exitSelectionMode}
          disabled={busy}
          aria-label="Exit selection mode"
        >
          Done
        </button>
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={selectAllPaths}
          disabled={busy || selectedCount === totalCount}
        >
          All
        </button>
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={clearSelectedPaths}
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
        <MoveMediaDialog
          currentFolder={currentFolder}
          selectedCount={selectedCount}
          busy={moving}
          onClose={closeMovePicker}
          onSelectDestination={(path) => {
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
