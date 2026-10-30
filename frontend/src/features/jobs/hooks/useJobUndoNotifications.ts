import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { undoJob } from "@/features/jobs/api/jobs";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import type { LiveJobs } from "@/features/jobs/lib/jobsCache";
import { failureMessage, pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { formatCount } from "@/shared/lib/format";
import {
  useNotificationActions,
  useNotify,
  type ToastAction,
} from "@/shared/notifications/notifications";
import type { NotificationRecord } from "@/shared/types";

function captions(count: number): string {
  return count === 1 ? "1 caption" : `${formatCount(count)} captions`;
}

/**
 * A caption job's outcome offers to take its writes back while the server still can. The
 * job's `undoable` flag goes false once used, which drops the button from toast and history.
 */
export function useJobUndoNotifications() {
  const queryClient = useQueryClient();
  const notify = useNotify();

  const undo = useCallback(
    async (jobId: string) => {
      try {
        const { restored, changed, failed } = await undoJob(jobId);
        if (restored.length > 0) {
          notify({ variant: "success", message: `Restored ${captions(restored.length)}.` });
        }
        if (changed.length > 0) {
          const names = changed.map(pathBaseName).join(", ");
          notify({ variant: "warning", message: `Kept captions edited since the job: ${names}.` });
        }
        if (failed.length > 0) {
          const failures = failed.map(({ path, detail }) => ({ path, error: detail }));
          notify({ variant: "danger", message: failureMessage("restore", failures) });
        }
      } catch (error) {
        notify({ variant: "danger", message: `Could not undo the job: ${formatApiError(error)}` });
      }
    },
    [notify],
  );

  // Read from the cache, not a render: the outcome's event can land before a re-render.
  const actionFor = useCallback(
    (record: NotificationRecord): ToastAction | undefined => {
      const jobId = record.job_id;
      if (!jobId) return undefined;
      const job = queryClient
        .getQueryData<LiveJobs>(jobKeys.live)
        ?.jobs.find((entry) => entry.id === jobId);
      if (!job?.undoable) return undefined;
      return { label: "Undo", run: () => void undo(jobId) };
    },
    [queryClient, undo],
  );
  useNotificationActions("caption-job-undo", actionFor);
}
