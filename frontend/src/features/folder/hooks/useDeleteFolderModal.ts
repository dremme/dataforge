import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { deleteFolder } from "@/features/folder/api/folders";
import { FAVORITES_QUERY_KEY } from "@/features/folder/hooks/useFolderFavorites";
import { forgetRecentFolder } from "@/features/folder/lib/folderPreferences";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";

type UseDeleteFolderModalOptions = {
  folderPath: string | undefined;
  folderLabel: string;
  /** Only while the open folder shows no media and no subfolders. */
  enabled: boolean;
  onDeleted: (parentPath: string) => Promise<void> | void;
};

export function useDeleteFolderModal({
  folderPath,
  folderLabel,
  enabled,
  onDeleted,
}: UseDeleteFolderModalOptions) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openModal = useCallback(() => {
    if (!enabled || !folderPath || busy) return;
    setOpen(true);
  }, [busy, enabled, folderPath]);

  const closeModal = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (!folderPath || busy) return;

    setBusy(true);

    try {
      const result = await deleteFolder(folderPath);
      setOpen(false);
      forgetRecentFolder(result.path);
      void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
      await onDeleted(result.parent);
      notify({
        variant: "success",
        message: result.deletes_to_trash
          ? `Moved folder ${folderLabel} to the Recycle Bin.`
          : `Deleted folder ${folderLabel}.`,
      });
    } catch (error: unknown) {
      // Closed even on failure: a 409 names what is left, and retrying would only fail again.
      setOpen(false);
      notify({ variant: "danger", message: formatApiError(error) });
    } finally {
      setBusy(false);
    }
  }, [busy, folderLabel, folderPath, notify, onDeleted, queryClient]);

  return useMemo(
    () => ({
      busy,
      openModal: enabled && folderPath ? openModal : undefined,
      overlay: open ? { folderLabel, busy, onConfirm: confirm, onCancel: closeModal } : null,
    }),
    [busy, closeModal, confirm, enabled, folderLabel, folderPath, open, openModal],
  );
}

export type DeleteFolderOverlayState = NonNullable<
  ReturnType<typeof useDeleteFolderModal>["overlay"]
>;
