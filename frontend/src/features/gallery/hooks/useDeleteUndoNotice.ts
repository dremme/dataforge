import { useCallback } from "react";
import { restoreDeletedMedia } from "@/features/gallery/api/media";
import { failureMessage, pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { formatCount } from "@/shared/lib/format";
import { UNDO_TOAST_DURATION_MS, useNotify } from "@/shared/notifications/notifications";
import type { MediaDeleteResponse } from "@/shared/types";

/**
 * Confirms a delete with an Undo that brings the files back from the Recycle Bin. Silent where
 * deletes are permanent: the server lists nothing as recycled there, so there is nothing to undo.
 */
export function useDeleteUndoNotice() {
  const notify = useNotify();

  return useCallback(
    (responses: readonly MediaDeleteResponse[], refresh: () => void | Promise<void>) => {
      const recycled = responses.filter((response) => response.recycled.length > 0);
      if (recycled.length === 0) return;

      const undo = async () => {
        const missing: string[] = [];
        const failed: Array<{ path: string; error: unknown }> = [];
        try {
          for (const response of recycled) {
            const result = await restoreDeletedMedia(response.recycled);
            missing.push(...result.missing);
            failed.push(...result.failed.map(({ path, detail }) => ({ path, error: detail })));
          }
        } catch (error) {
          notify({
            variant: "danger",
            message: `Could not undo the delete: ${formatApiError(error)}`,
          });
        } finally {
          await refresh();
        }
        if (missing.length > 0) {
          const names = missing.map(pathBaseName).join(", ");
          notify({ variant: "warning", message: `No longer in the Recycle Bin: ${names}.` });
        }
        if (failed.length > 0) {
          notify({ variant: "danger", message: failureMessage("restore", failed) });
        }
      };

      const message =
        recycled.length === 1
          ? `Deleted ${pathBaseName(recycled[0].path)}.`
          : `Deleted ${formatCount(recycled.length)} files.`;
      notify({
        variant: "success",
        message,
        durationMs: UNDO_TOAST_DURATION_MS,
        action: { label: "Undo", run: () => void undo() },
      });
    },
    [notify],
  );
}
