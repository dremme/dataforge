import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteSelectedMedia, type MediaTransferMode } from "@/features/gallery/api/media";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { useMediaTransfer } from "@/features/gallery/hooks/useMediaTransfer";
import { failureMessage, pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { useNotify } from "@/shared/notifications/notifications";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import { iconCopy, iconFolderInput, iconLoader2, iconTrash2, type AppIcon } from "@/shared/icons";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { TransferMediaDialog } from "@/features/gallery/components/TransferMediaDialog";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface TransferButtonProps {
  mode: MediaTransferMode;
  icon: AppIcon;
  /** Names the action for the tooltip and, since the button is icon-only, for
   *  its accessible name too. The spinner is what reports the busy state. */
  label: string;
  /** Which transfer is running, so only that button shows its spinner. */
  transferring: MediaTransferMode | null;
  disabled: boolean;
  onClick: () => void;
}

function TransferButton({
  mode,
  icon,
  label,
  transferring,
  disabled,
  onClick,
}: TransferButtonProps) {
  const active = transferring === mode;

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="gallery-controls__btn gallery-controls__btn--icon"
        onClick={onClick}
        disabled={disabled}
        aria-busy={active || undefined}
        aria-label={label}
      >
        <Icon
          icon={active ? iconLoader2 : icon}
          spin={active}
          className="gallery-controls__btn-icon"
        />
      </button>
    </Tooltip>
  );
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
  const notify = useNotify();

  const transferPaths = useMemo(() => Array.from(selectedPaths), [selectedPaths]);

  const onMoveSettled = useCallback(
    (succeeded: string[]) => {
      if (succeeded.length === totalCount) {
        exitSelectionMode();
      }
    },
    [exitSelectionMode, totalCount],
  );

  const transfer = useMediaTransfer({
    paths: transferPaths,
    onMoved,
    onCopied,
    onMoveSettled,
  });

  const { transferPicker, overwritePrompt, transferring } = transfer;
  const busy = deleting || transferring !== null;

  const openDeleteConfirm = useCallback(() => {
    if (busy || selectedCount === 0) return;
    setDeleteConfirmOpen(true);
  }, [busy, selectedCount]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  // Escape unwinds selection mode one step at a time: it empties a selection
  // first, and only leaves the mode once there is nothing left to lose. A single
  // press still exits when nothing is selected, so the extra press is only ever
  // charged to the case where it protects work.
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
      if (selectedCount > 0) {
        clearSelectedPaths();
        return;
      }
      exitSelectionMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedPaths, exitSelectionMode, selectedCount, selectionMode]);

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
        This will delete <strong>{pathBaseName(Array.from(selectedPaths)[0])}</strong> and any
        matching caption sidecars ({CAPTION_SIDECAR_EXTENSION_LIST}) in this folder. On Windows,
        files are moved to the Recycle Bin.
      </span>
    ) : (
      <span>
        This will delete <strong>{selectedCount} selected files</strong> and any matching caption
        sidecars ({CAPTION_SIDECAR_EXTENSION_LIST}) in this folder. On Windows, files are moved to
        the Recycle Bin.
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
          label="Copy selected files"
          transferring={transferring}
          disabled={selectedCount === 0 || busy}
          onClick={() => transfer.openTransferPicker("copy")}
        />
        <TransferButton
          mode="move"
          icon={iconFolderInput}
          label="Move selected files"
          transferring={transferring}
          disabled={selectedCount === 0 || busy}
          onClick={() => transfer.openTransferPicker("move")}
        />
        <Tooltip content="Delete selected files">
          <button
            type="button"
            className="gallery-controls__btn gallery-controls__btn--icon gallery-controls__btn--danger"
            onClick={openDeleteConfirm}
            disabled={selectedCount === 0 || busy}
            aria-busy={deleting || undefined}
            aria-label="Delete selected files"
          >
            <Icon
              icon={deleting ? iconLoader2 : iconTrash2}
              spin={deleting}
              className="gallery-controls__btn-icon"
            />
          </button>
        </Tooltip>
      </div>

      {transferPicker && (
        <TransferMediaDialog
          mode={transferPicker}
          currentFolder={currentFolder}
          selectedCount={selectedCount}
          busy={transferring !== null}
          onClose={transfer.closeTransferPicker}
          onSelectDestination={(path) => {
            transfer.selectDestination(transferPicker, path);
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
          onReplaceExisting={() => transfer.confirmOverwrite(true)}
          onCopyNewOnly={() => transfer.confirmOverwrite(false)}
          onCancel={transfer.closeOverwritePrompt}
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
