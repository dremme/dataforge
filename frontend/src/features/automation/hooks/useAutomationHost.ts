import { useCallback, useMemo } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import { useAutomationDialogOverlays } from "@/features/automation/hooks/useAutomationDialogOverlays";
import type { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useJobStartConfirmation } from "@/features/jobs/hooks/useJobStartConfirmation";
import {
  isConfirmableJobType,
  isImmediateJobType,
  isJobAvailable,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import type { Breadcrumb, GalleryItem, JobType } from "@/shared/types";

type FolderAutomation = ReturnType<typeof useFolderAutomation>;

type UseAutomationHostOptions = {
  folder: string | undefined;
  breadcrumbs: Breadcrumb[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  sysprompt: GalleryItem | null;
  hasCaptionBackup: boolean;
  getJobPaths: () => string[] | undefined;
  automation: FolderAutomation;
  onEditSysprompt: () => void;
  issueCount: number;
  onResolveIssues?: () => void;
};

/**
 * Job start UX (dialog vs confirm via registry), panel props, and overlay slices.
 * Receives folder automation core so change-detection can suspend on active jobs first.
 */
export function useAutomationHost({
  folder,
  breadcrumbs,
  items,
  filteredItems,
  sysprompt,
  hasCaptionBackup,
  getJobPaths,
  automation,
  onEditSysprompt,
  issueCount,
  onResolveIssues,
}: UseAutomationHostOptions) {
  const jobStart = useJobStartConfirmation(
    folder,
    breadcrumbs,
    {
      strip_metadata: automation.startStripMetadataJob,
      restore_captions: automation.startRestoreCaptionsJob,
    },
    getJobPaths,
  );

  const dialogs = useAutomationDialogOverlays({
    folderPath: folder,
    folderLabel: jobStart.folderLabel,
    startingJobType: automation.startingJobType,
    itemCount: getJobPaths()?.length ?? items.length,
    startSetCaptionsJob: automation.startSetCaptionsJob,
    startBodyPartsJob: automation.startBodyPartsJob,
    startAutoCaptionJob: automation.startAutoCaptionJob,
    startVerifyCaptionsJob: automation.startVerifyCaptionsJob,
    startBatchRenameJob: automation.startBatchRenameJob,
    getJobPaths,
  });

  const {
    requestJobStart,
    folderLabel,
    pendingJobStart,
    confirmPendingJobStart,
    cancelPendingJobStart,
  } = jobStart;
  const { openDialogForJobType, dialogs: automationDialogs } = dialogs;

  const immediateStarters = useMemo(
    () => ({ backup_captions: automation.startBackupCaptionsJob }),
    [automation.startBackupCaptionsJob],
  );

  const jobAvailability = useMemo<JobAvailability>(
    () => ({ hasCaptionBackup }),
    [hasCaptionBackup],
  );

  const requestStart = useCallback(
    (jobType: JobType) => {
      // The menu already disables these; re-checked so a stale flag cannot start a job.
      if (!isJobAvailable(jobType, jobAvailability)) return;
      if (isConfirmableJobType(jobType)) {
        requestJobStart(jobType);
        return;
      }
      if (isImmediateJobType(jobType)) {
        if (!folder) return;
        immediateStarters[jobType](folder, getJobPaths()).catch(() => {
          // Errors are stored in jobs context state.
        });
        return;
      }
      openDialogForJobType(jobType);
    },
    [
      folder,
      getJobPaths,
      jobAvailability,
      immediateStarters,
      openDialogForJobType,
      requestJobStart,
    ],
  );

  const panelProps = useMemo<AutomationPanelProps>(
    () => ({
      filteredItems,
      job: automation.folderJob,
      startingJobType: automation.startingJobType,
      canStart: !automation.folderHasActiveJob,
      hasSyspromptFile: Boolean(sysprompt),
      hasSyspromptContent: sysprompt?.has_description ?? false,
      jobAvailability,
      onEditSysprompt,
      onRequestStart: requestStart,
      cancellingJob: automation.cancellingJob,
      onCancelJob: automation.cancelFolderJob,
      issueCount,
      onResolveIssues,
    }),
    [
      automation.cancelFolderJob,
      automation.cancellingJob,
      automation.folderHasActiveJob,
      automation.folderJob,
      automation.startingJobType,
      filteredItems,
      jobAvailability,
      issueCount,
      onEditSysprompt,
      onResolveIssues,
      requestStart,
      sysprompt,
    ],
  );

  return {
    panelProps,
    dialogs: automationDialogs,
    jobStartConfirm: {
      pending: pendingJobStart,
      folderLabel,
      onConfirm: confirmPendingJobStart,
      onCancel: cancelPendingJobStart,
    },
  };
}
