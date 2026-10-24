import { useCallback } from "react";
import { cleanUpAfterDelete } from "@/features/gallery/api/media";
import { leftoversMessage, withLeftovers } from "@/features/gallery/lib/deleteLeftovers";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { MediaDeleteResponse } from "@/shared/types";

/**
 * Warns about files deletes left behind, with a Retry that deletes only those files. The server
 * checks each still belongs to the deleted media, so a late retry cannot remove anything else.
 */
export function useDeleteLeftoversNotice() {
  const notify = useNotify();

  return useCallback(
    (responses: readonly MediaDeleteResponse[]) => {
      function report(current: readonly MediaDeleteResponse[]) {
        const leftovers = withLeftovers(current);
        if (leftovers.length === 0) return;

        const retry = async () => {
          try {
            const retried = await Promise.all(
              leftovers.map((response) =>
                cleanUpAfterDelete(
                  response.path,
                  response.retained.map((file) => file.path),
                ),
              ),
            );
            if (withLeftovers(retried).length === 0) {
              notify({ variant: "success", message: "Removed the files left behind." });
            } else {
              report(retried);
            }
          } catch (error) {
            notify({
              variant: "danger",
              message: `Could not remove them: ${formatApiError(error)}`,
            });
          }
        };

        notify({
          variant: "warning",
          message: leftoversMessage(leftovers),
          action: { label: "Retry", run: () => void retry() },
        });
      }

      report(responses);
    },
    [notify],
  );
}
