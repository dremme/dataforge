import { useCallback, useState } from "react";
import { createFolder } from "@/features/browse/api/folders";
import { formatApiError } from "@/shared/api/http";

type UseCreateFolderDialogOptions = {
  parentFolder: string | undefined;
  parentLabel: string;
  enabled: boolean;
  onCreated: (path: string) => Promise<void> | void;
};

export function useCreateFolderDialog({
  parentFolder,
  parentLabel,
  enabled,
  onCreated,
}: UseCreateFolderDialogOptions) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = useCallback(() => {
    if (!enabled || !parentFolder) return;
    setError(null);
    setOpen(true);
  }, [enabled, parentFolder]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
  }, [busy]);

  const confirm = useCallback(
    async (name: string) => {
      if (!parentFolder || busy) return;

      setBusy(true);
      setError(null);

      try {
        const created = await createFolder(parentFolder, name);
        setOpen(false);
        await onCreated(created.path);
      } catch (err) {
        setError(formatApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onCreated, parentFolder],
  );

  return {
    open,
    busy,
    error,
    parentLabel,
    openDialog,
    closeDialog,
    confirm,
    overlay: open
      ? {
          parentLabel,
          busy,
          error,
          onConfirm: confirm,
          onCancel: closeDialog,
        }
      : null,
  };
}
