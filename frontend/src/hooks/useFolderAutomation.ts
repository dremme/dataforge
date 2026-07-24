import { useCallback } from "react";
import { isStartingJobForFolder } from "../context/jobStartHelpers";
import { useJobTransitions, useJobs, useFolderJob } from "../context/JobsContext";
import { foldersMatch } from "../utils/folderPath";

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

  return {
    folderJob,
    folderHasActiveJob,
    startingAutoCaption: isStartingJobForFolder(startingJob, folder, "auto_caption"),
    startingBodyParts: isStartingJobForFolder(startingJob, folder, "body_parts"),
    startingStripMetadata: isStartingJobForFolder(startingJob, folder, "strip_metadata"),
    startingSetCaptions: isStartingJobForFolder(startingJob, folder, "set_captions"),
    startingVerifyCaptions: isStartingJobForFolder(startingJob, folder, "verify_captions"),
    startingBatchRename: isStartingJobForFolder(startingJob, folder, "batch_rename"),
    cancellingJob: folderJob ? cancellingJobId === folderJob.id : false,
    cancelFolderJob,
    startBodyPartsJob,
    startStripMetadataJob,
    startSetCaptionsJob,
    startAutoCaptionJob,
    startVerifyCaptionsJob,
    startBatchRenameJob,
  };
}
