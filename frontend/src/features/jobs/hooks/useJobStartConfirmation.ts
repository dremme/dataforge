import { useCallback, useState } from "react";
import type { ConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { Breadcrumb, JobType } from "@/shared/types";

type StartJob = (
  jobType: JobType,
  folder: string,
  body?: undefined,
  paths?: string[],
) => Promise<unknown>;

export function useJobStartConfirmation(
  folder: string | undefined,
  breadcrumbs: Breadcrumb[],
  startJob: StartJob,
  getJobPaths?: () => string[] | undefined,
) {
  const [pendingJobStart, setPendingJobStart] = useState<ConfirmableJobType | null>(null);

  const folderLabel = breadcrumbs[breadcrumbs.length - 1]?.name ?? folder ?? "this folder";

  const requestJobStart = useCallback((jobType: ConfirmableJobType) => {
    setPendingJobStart(jobType);
  }, []);

  const cancelPendingJobStart = useCallback(() => {
    setPendingJobStart(null);
  }, []);

  const confirmPendingJobStart = useCallback(() => {
    if (!pendingJobStart || !folder) return;

    const jobType = pendingJobStart;
    const paths = getJobPaths?.();
    setPendingJobStart(null);
    startJob(jobType, folder, undefined, paths).catch(() => {
      // Errors are stored in jobs context state.
    });
  }, [folder, getJobPaths, pendingJobStart, startJob]);

  return {
    pendingJobStart,
    requestJobStart,
    cancelPendingJobStart,
    confirmPendingJobStart,
    folderLabel,
  };
}
