import { useCallback, useMemo } from "react";
import { foldersMatch } from "@/features/browse/lib/folderPath";
import { useFolderJob, useJobTransitions, useJobs } from "@/features/jobs/context/JobsContext";
import { isStartingJobForFolder } from "@/features/jobs/lib/jobStartHelpers";
import type { JobType } from "@/shared/types";

export function useFolderAutomation(
  folder: string | undefined,
  reloadFolder: () => Promise<unknown>,
) {
  const {
    startBodyPartsJob,
    startStripMetadataJob,
    startSetCaptionsJob,
    startAutoCaptionJob,
    startVerifyCaptionsJob,
    startBatchRenameJob,
    startBackupCaptionsJob,
    startRestoreCaptionsJob,
    startTrainLoraJob,
    cancelJob,
    cancellingJobId,
    startingJob,
  } = useJobs();
  const { job: folderJob, folderHasActiveJob } = useFolderJob(folder);

  const handleTerminalJob = useCallback(
    (folderPath: string) => {
      if (!folder || !foldersMatch(folderPath, folder)) return;
      reloadFolder().catch(() => {
        // Browse refresh failures are surfaced by folder navigation.
      });
    },
    [folder, reloadFolder],
  );

  useJobTransitions(handleTerminalJob);

  const cancelFolderJob = useCallback(() => {
    if (!folderJob) return;
    cancelJob(folderJob.id).catch(() => {
      // Errors are stored in context state.
    });
  }, [cancelJob, folderJob]);

  const startingJobType = useMemo((): JobType | null => {
    if (!startingJob || !folder) return null;
    if (!foldersMatch(startingJob.folder, folder)) return null;
    return startingJob.jobType;
  }, [folder, startingJob]);

  const isStartingType = useCallback(
    (jobType: JobType) => isStartingJobForFolder(startingJob, folder, jobType),
    [folder, startingJob],
  );

  return {
    folderJob,
    folderHasActiveJob,
    startingJobType,
    isStarting: startingJobType !== null,
    isStartingType,
    cancellingJob: folderJob ? cancellingJobId === folderJob.id : false,
    cancelFolderJob,
    startBodyPartsJob,
    startStripMetadataJob,
    startSetCaptionsJob,
    startAutoCaptionJob,
    startVerifyCaptionsJob,
    startBatchRenameJob,
    startBackupCaptionsJob,
    startRestoreCaptionsJob,
    startTrainLoraJob,
  };
}
