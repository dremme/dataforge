import { useCallback, useMemo, useState } from "react";
import { deleteSelectedMedia, type MediaTransferMode } from "@/features/gallery/api/media";
import { useDeleteLeftoversNotice } from "@/features/gallery/hooks/useDeleteLeftoversNotice";
import { useDeleteUndoNotice } from "@/features/gallery/hooks/useDeleteUndoNotice";
import { useMediaTransfer } from "@/features/gallery/hooks/useMediaTransfer";
import {
  failureMessage,
  singleFileCopySuccessMessage,
  singleFileEmptyPreviewMessage,
} from "@/features/gallery/lib/mediaActionMessages";
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
  const notifyDeleteLeftovers = useDeleteLeftoversNotice();
  const notifyDeleteUndo = useDeleteUndoNotice();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Set by a card's own Delete; otherwise the confirm acts on the selection.
  const [deleteTarget, setDeleteTarget] = useState<ReadonlySet<string> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletePaths = deleteTarget ?? visibleSelectedPaths;
  // Set by a card's own Move or Copy; otherwise the transfer acts on the selection.
  const [transferTarget, setTransferTarget] = useState<string | null>(null);

  const selectionPaths = useMemo(() => Array.from(visibleSelectedPaths), [visibleSelectedPaths]);
  const transferPaths = useMemo(
    () => (transferTarget ? [transferTarget] : selectionPaths),
    [selectionPaths, transferTarget],
  );

  const transfer = useMediaTransfer({
    paths: transferPaths,
    onMoved,
    onCopied,
    emptyPreviewMessage: transferTarget ? singleFileEmptyPreviewMessage : undefined,
    copySuccessMessage: transferTarget ? singleFileCopySuccessMessage : undefined,
  });

  const { transferPicker, overwritePrompt, transferring, openTransferPicker } = transfer;
  const busy = deleting || transferring !== null;

  const openDeleteConfirm = useCallback(() => {
    if (busy || visibleSelectedCount === 0) return;
    setDeleteTarget(null);
    setDeleteConfirmOpen(true);
  }, [busy, visibleSelectedCount]);

  const openDeleteConfirmFor = useCallback(
    (path: string) => {
      if (busy) return;
      setDeleteTarget(new Set([path]));
      setDeleteConfirmOpen(true);
    },
    [busy],
  );

  const cancelDeleteConfirm = useCallback(() => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }, [deleting]);

  const notifyCopyCaptionFailed = useCallback(() => {
    notify({ variant: "danger", message: "Could not copy the caption." });
  }, [notify]);

  const confirmDelete = useCallback(async () => {
    const paths = Array.from(deletePaths);
    if (paths.length === 0 || deleting) return;

    setDeleting(true);

    try {
      const { succeeded, failed, responses } = await deleteSelectedMedia(paths);

      if (succeeded.length > 0) {
        await onDeleted(succeeded);
      }

      setDeleteConfirmOpen(false);
      setDeleteTarget(null);

      if (failed.length > 0) {
        notify({ variant: "danger", message: failureMessage("delete", failed) });
      }
      notifyDeleteLeftovers(responses);
      // onCopied refreshes the folder, which is all restored files need to show up again.
      notifyDeleteUndo(responses, onCopied);
    } finally {
      setDeleting(false);
    }
  }, [deleting, deletePaths, notify, notifyDeleteLeftovers, notifyDeleteUndo, onCopied, onDeleted]);

  const canAct = visibleSelectedCount > 0 && !busy;

  const startTransfer = useCallback(
    (mode: MediaTransferMode) => {
      setTransferTarget(null);
      openTransferPicker(mode, selectionPaths);
    },
    [openTransferPicker, selectionPaths],
  );

  const startTransferFor = useCallback(
    (path: string, mode: MediaTransferMode) => {
      if (busy) return;
      setTransferTarget(path);
      openTransferPicker(mode, [path]);
    },
    [busy, openTransferPicker],
  );

  return useMemo(
    () => ({
      busy,
      deleting,
      transferring,
      canAct,
      openDeleteConfirm,
      openDeleteConfirmFor,
      notifyCopyCaptionFailed,
      startTransfer,
      startTransferFor,
      overlay: {
        currentFolder,
        selectedCount: visibleSelectedCount,
        transferPath: transferTarget,
        transferPicker,
        overwritePrompt,
        transferring,
        deleteConfirmOpen,
        deletePaths,
        deletesSelection: deleteTarget === null,
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
      deletePaths,
      deleteTarget,
      deleting,
      notifyCopyCaptionFailed,
      openDeleteConfirm,
      openDeleteConfirmFor,
      overwritePrompt,
      startTransfer,
      startTransferFor,
      transfer.closeOverwritePrompt,
      transfer.closeTransferPicker,
      transfer.confirmOverwrite,
      transfer.selectDestination,
      transferPicker,
      transferTarget,
      transferring,
      visibleSelectedCount,
    ],
  );
}

export type GallerySelectionActions = ReturnType<typeof useGallerySelectionActions>;
