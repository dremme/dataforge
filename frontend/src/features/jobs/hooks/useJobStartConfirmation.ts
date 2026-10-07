import { useCallback, useEffect, useRef, useState } from "react";
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
  const targetRef = useRef<{ folder: string; paths?: string[] } | null>(null);

  const folderLabel = breadcrumbs[breadcrumbs.length - 1]?.name ?? folder ?? "this folder";

  const requestJobStart = useCallback(
    (jobType: ConfirmableJobType, explicitPaths?: string[]) => {
      if (!folder) return;
      const paths = explicitPaths ?? getJobPaths?.();
      if (paths?.length === 0) return;
      targetRef.current = { folder, paths: paths ? [...paths] : undefined };
      setPendingJobStart(jobType);
    },
    [folder, getJobPaths],
  );

  const cancelPendingJobStart = useCallback(() => {
    targetRef.current = null;
    setPendingJobStart(null);
  }, []);

  useEffect(() => cancelPendingJobStart(), [cancelPendingJobStart, folder]);

  const confirmPendingJobStart = useCallback(() => {
    if (!pendingJobStart || !targetRef.current) return;

    const jobType = pendingJobStart;
    const { folder: targetFolder, paths } = targetRef.current;
    setPendingJobStart(null);
    startJob(jobType, targetFolder, undefined, paths).catch(() => {
      // Errors are stored in jobs context state.
    });
  }, [pendingJobStart, startJob]);

  return {
    pendingJobStart,
    requestJobStart,
    cancelPendingJobStart,
    confirmPendingJobStart,
    folderLabel,
  };
}
