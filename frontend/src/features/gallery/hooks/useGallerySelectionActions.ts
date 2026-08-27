import { useCallback, useMemo, useState } from "react";
import { deleteSelectedMedia, type MediaTransferMode } from "@/features/gallery/api/media";
import { useMediaTransfer } from "@/features/gallery/hooks/useMediaTransfer";
import { failureMessage } from "@/features/gallery/lib/mediaActionMessages";
import { useNotify } from "@/shared/notifications/notifications";

interface UseGallerySelectionActionsOptions {
  currentFolder: string | undefined;
  visibleSelectedPaths: ReadonlySet<string>;
  visibleSelectedCount: number;
  onDeleted: (paths: string[]) => void | Promise<void>;
  onMoved: (paths: string[]) => void | Promise<void>;
  onCopied: () => void | Promise<void>;
}

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

      if (failed.length > 0) {
        notify({ variant: "danger", message: failureMessage("delete", failed) });
      }
    } finally {
      setDeleting(false);
    }
  }, [deleting, notify, onDeleted, visibleSelectedPaths]);

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
