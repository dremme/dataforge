import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { renameFolder } from "@/features/folder/api/folders";
import { FAVORITES_QUERY_KEY } from "@/features/folder/hooks/useFolderFavorites";
import { forgetRecentFolder } from "@/features/folder/lib/folderPreferences";
import { formatApiError } from "@/shared/api/http";

type UseRenameFolderDialogOptions = {
  folderPath: string | undefined;
  folderName: string;
  /** Only while the open folder shows no media and no subfolders. */
  enabled: boolean;
  onRenamed: (path: string) => Promise<void> | void;
};

export function useRenameFolderDialog({
  folderPath,
  folderName,
  enabled,
  onRenamed,
}: UseRenameFolderDialogOptions) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback(() => {
    if (!enabled || !folderPath || busy) return;
    setError(null);
    setOpen(true);
  }, [busy, enabled, folderPath]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  const confirm = useCallback(
    async (name: string) => {
      if (!folderPath || busy) return;

      setBusy(true);
      setError(null);

      try {
        const result = await renameFolder(folderPath, name);
        setOpen(false);
        forgetRecentFolder(result.source);
        void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
        await onRenamed(result.destination);
      } catch (err) {
        setError(formatApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, folderPath, onRenamed, queryClient],
  );

  return useMemo(
    () => ({
      busy,
      openDialog: enabled && folderPath ? openDialog : undefined,
      overlay: open ? { folderName, busy, error, onConfirm: confirm, onCancel: closeDialog } : null,
    }),
    [busy, closeDialog, confirm, enabled, error, folderName, folderPath, open, openDialog],
  );
}

export type RenameFolderOverlayState = NonNullable<
  ReturnType<typeof useRenameFolderDialog>["overlay"]
>;
