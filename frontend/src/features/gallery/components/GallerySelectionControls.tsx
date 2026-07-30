import { useCallback, useEffect, useState } from "react";
import {
  deleteSelectedMedia,
  previewMediaTransfer,
  transferSelectedMedia,
  type MediaTransferMode,
} from "@/features/gallery/api/media";
import { folderLeafName } from "@/features/browse/lib/folderPath";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import { iconCopy, iconFolderInput, iconLoader2, iconTrash2, type AppIcon } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/browse/components/FileImportOverwriteDialog";
import { TransferMediaDialog } from "@/features/gallery/components/TransferMediaDialog";
import { Icon } from "@/shared/ui/Icon";

function pathBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

interface TransferButtonProps {
  mode: MediaTransferMode;
  icon: AppIcon;
  label: string;
  busyLabel: string;
  /** Which transfer is running, so only that button shows its spinner. */
  transferring: MediaTransferMode | null;
  disabled: boolean;
  onClick: () => void;
}

function TransferButton({
  mode,
  icon,
  label,
  busyLabel,
  transferring,
  disabled,
  onClick,
}: TransferButtonProps) {
  const active = transferring === mode;

  return (
    <button
      type="button"
      className="gallery-controls__btn"
      onClick={onClick}
      disabled={disabled}
      aria-busy={active || undefined}
    >
      {active ? (
        <>
          <Icon icon={iconLoader2} spin className="gallery-controls__btn-icon" />
          {busyLabel}
        </>
      ) : (
        <>
          <Icon icon={icon} className="gallery-controls__btn-icon" />
          {label}
        </>
      )}
    </button>
  );
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
  /** Folder the selected media currently lives in — the transfer dialog's origin. */
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
    onCopied,
  } = useGallerySelectionContext();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Non-null while the destination picker is open, and says which action it is for. */
  const [transferPicker, setTransferPicker] = useState<MediaTransferMode | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<{
    mode: MediaTransferMode;
    destination: string;
    conflicts: string[];
  } | null>(null);
  const [transferring, setTransferring] = useState<MediaTransferMode | null>(null);
  const notify = useNotify();

  const busy = deleting || transferring !== null;

  const openDeleteConfirm = useCallback(() => {
    if (busy || selectedCount === 0) return;
    setDeleteConfirmOpen(true);
  }, [busy, selectedCount]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  const openTransferPicker = useCallback(
    (mode: MediaTransferMode) => {
      if (busy || selectedCount === 0) return;
      setTransferPicker(mode);
    },
    [busy, selectedCount],
  );

  const closeTransferPicker = useCallback(() => {
    if (transferring) return;
    setTransferPicker(null);
  }, [transferring]);

  const closeOverwritePrompt = useCallback(() => {
    if (transferring) return;
    setOverwritePrompt(null);
  }, [transferring]);

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

  const executeTransfer = useCallback(
    async (mode: MediaTransferMode, destinationFolder: string, overwrite: boolean) => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0 || transferring) return;

      setTransferring(mode);

      try {
        const { succeeded, failed } = await transferSelectedMedia(
          mode,
          destinationFolder,
          paths,
          overwrite,
        );

        if (succeeded.length > 0) {
          // A move empties the source folder; a copy only changes folder stats.
          await (mode === "move" ? onMoved(succeeded) : onCopied());
        }

        setTransferPicker(null);
        setOverwritePrompt(null);

        // The backend reports per-file failures in its 200 response, so nothing throws here.
        if (failed.length > 0) {
          notify({ variant: "danger", message: failureMessage(mode, failed) });
        }

        if (mode === "copy") {
          // Nothing changes in this folder, so say so rather than leaving it silent.
          if (succeeded.length > 0) {
            const target = folderLeafName(destinationFolder) || destinationFolder;
            const count =
              succeeded.length === 1 ? "1 file" : `${succeeded.length.toLocaleString()} files`;
            notify({ variant: "success", message: `Copied ${count} to ${target}.` });
          }
          return;
        }

        if (succeeded.length === totalCount) {
          exitSelectionMode();
        }
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        setTransferring(null);
      }
    },
    [transferring, notify, exitSelectionMode, onCopied, onMoved, selectedPaths, totalCount],
  );

  const handleDestinationSelected = useCallback(
    async (mode: MediaTransferMode, destinationFolder: string) => {
      const paths = Array.from(selectedPaths);
      if (paths.length === 0 || transferring) return;

      setTransferring(mode);

      try {
        const preview = await previewMediaTransfer(mode, destinationFolder, paths);
        setTransferPicker(null);

        if (preview.eligible.length === 0 && preview.conflicts.length === 0) {
          notify({
            variant: "warning",
            message: `No selected files can be ${mode === "move" ? "moved" : "copied"} to that folder.`,
          });
          return;
        }

        if (preview.conflicts.length > 0) {
          setOverwritePrompt({
            mode,
            destination: destinationFolder,
            conflicts: preview.conflicts,
          });
          return;
        }

        await executeTransfer(mode, destinationFolder, false);
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
      } finally {
        setTransferring(null);
      }
    },
    [executeTransfer, transferring, notify, selectedPaths],
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
        <TransferButton
          mode="copy"
          icon={iconCopy}
          label="Copy"
          busyLabel="Copying..."
          transferring={transferring}
          disabled={selectedCount === 0 || busy}
          onClick={() => openTransferPicker("copy")}
        />
        <TransferButton
          mode="move"
          icon={iconFolderInput}
          label="Move"
          busyLabel="Moving..."
          transferring={transferring}
          disabled={selectedCount === 0 || busy}
          onClick={() => openTransferPicker("move")}
        />
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

      {transferPicker && (
        <TransferMediaDialog
          mode={transferPicker}
          currentFolder={currentFolder}
          selectedCount={selectedCount}
          busy={transferring !== null}
          onClose={closeTransferPicker}
          onSelectDestination={(path) => {
            void handleDestinationSelected(transferPicker, path);
          }}
        />
      )}

      {overwritePrompt && (
        <FileImportOverwriteDialog
          conflicts={overwritePrompt.conflicts}
          busy={transferring !== null}
          descriptionSuffix={
            overwritePrompt.mode === "move"
              ? "Choose whether to replace them or move only new files."
              : "Choose whether to replace them or copy only new files."
          }
          onReplaceExisting={() => {
            void executeTransfer(overwritePrompt.mode, overwritePrompt.destination, true);
          }}
          onCopyNewOnly={() => {
            void executeTransfer(overwritePrompt.mode, overwritePrompt.destination, false);
          }}
          onCancel={closeOverwritePrompt}
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
