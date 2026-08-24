import { useCallback, useMemo, useState } from "react";
import { deleteSelectedMedia, type MediaTransferMode } from "@/features/gallery/api/media";
import { useMediaTransfer } from "@/features/gallery/hooks/useMediaTransfer";
import { failureMessage } from "@/features/gallery/lib/mediaActionMessages";
import { useNotify } from "@/shared/notifications/notifications";

interface UseGallerySelectionActionsOptions {
  /** Folder the selected media lives in — the transfer dialog's origin. */
  currentFolder: string | undefined;
  /**
   * The selection scoped to the filtered view. Batch actions deliberately reach
   * no further: what the user can see selected is what gets moved or deleted.
   */
  visibleSelectedPaths: ReadonlySet<string>;
  visibleSelectedCount: number;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
  onCopied: () => void | Promise<void>;
}

/**
 * Delete / move / copy for the gallery selection.
 *
 * Composed at the workspace level rather than inside `GallerySelectionControls`
 * so the quick action bar can start the same flows the toolbar buttons do, and
 * so the dialogs outlive the toolbar: the controls unmount as soon as a filter
 * empties the grid, which used to take a half-finished transfer with them.
 */
export function useGallerySelectionActions({
  currentFolder,
  visibleSelectedPaths,
  visibleSelectedCount,
  onDeleted,
  onMoved,
  onCopied,
}: UseGallerySelectionActionsOptions) {
  const notify = useNotify();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const transferPaths = useMemo(() => Array.from(visibleSelectedPaths), [visibleSelectedPaths]);

  const transfer = useMediaTransfer({
    paths: transferPaths,
    onMoved,
    onCopied,
  });

  const { transferPicker, overwritePrompt, transferring, openTransferPicker } = transfer;
  const busy = deleting || transferring !== null;

  const openDeleteConfirm = useCallback(() => {
    if (busy || visibleSelectedCount === 0) return;
    setDeleteConfirmOpen(true);
  }, [busy, visibleSelectedCount]);

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    const paths = Array.from(visibleSelectedPaths);
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
    } finally {
      setDeleting(false);
    }
  }, [deleting, notify, onDeleted, visibleSelectedPaths]);

  /** Whether a batch action can start right now. */
  const canAct = visibleSelectedCount > 0 && !busy;

  const startTransfer = useCallback(
    (mode: MediaTransferMode) => {
      openTransferPicker(mode);
    },
    [openTransferPicker],
  );

  return useMemo(
    () => ({
      busy,
      deleting,
      transferring,
      canAct,
      openDeleteConfirm,
      startTransfer,
      overlay: {
        currentFolder,
        // The dialogs name and count exactly what the action will touch.
        selectedPaths: visibleSelectedPaths,
        selectedCount: visibleSelectedCount,
        transferPicker,
        overwritePrompt,
        transferring,
        deleteConfirmOpen,
        deleting,
        onCloseTransferPicker: transfer.closeTransferPicker,
        onSelectDestination: transfer.selectDestination,
        onConfirmOverwrite: transfer.confirmOverwrite,
        onCloseOverwritePrompt: transfer.closeOverwritePrompt,
        onConfirmDelete: confirmDelete,
        onCancelDelete: cancelDeleteConfirm,
      },
    }),
    [
      busy,
      canAct,
      cancelDeleteConfirm,
      confirmDelete,
      currentFolder,
      deleteConfirmOpen,
      deleting,
      openDeleteConfirm,
      overwritePrompt,
      startTransfer,
      transfer.closeOverwritePrompt,
      transfer.closeTransferPicker,
      transfer.confirmOverwrite,
      transfer.selectDestination,
      transferPicker,
      transferring,
      visibleSelectedCount,
      visibleSelectedPaths,
    ],
  );
}

export type GallerySelectionActions = ReturnType<typeof useGallerySelectionActions>;
