import { useCallback, useState } from "react";
import type { ConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { Breadcrumb } from "@/shared/types";

export type ConfirmableJobStarters = {
  [K in ConfirmableJobType]: (folder: string, paths?: string[]) => Promise<unknown>;
};

export function useJobStartConfirmation(
  folder: string | undefined,
  breadcrumbs: Breadcrumb[],
  starters: ConfirmableJobStarters,
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
    starters[jobType](folder, paths).catch(() => {
      // Errors are stored in jobs context state.
    });
  }, [folder, getJobPaths, pendingJobStart, starters]);

  return {
    pendingJobStart,
    requestJobStart,
    cancelPendingJobStart,
    confirmPendingJobStart,
    folderLabel,
  };
}
