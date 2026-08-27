import { useCallback, useMemo } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import { useAutomationDialogOverlays } from "@/features/automation/hooks/useAutomationDialogOverlays";
import type { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useJobStartConfirmation } from "@/features/jobs/hooks/useJobStartConfirmation";
import {
  isConfirmableJobType,
  isJobAvailable,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import type { Breadcrumb, GalleryItem, JobType } from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

type FolderAutomation = ReturnType<typeof useFolderAutomation>;

type UseAutomationHostOptions = {
  folder: string | undefined;
  breadcrumbs: Breadcrumb[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  sysprompt: GalleryItem | null;
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
  comfyPresetsAvailable: boolean;
  getJobPaths: () => string[] | undefined;
  automation: FolderAutomation;
  onEditSysprompt: () => void;
  issueCount: number;
  onResolveIssues?: () => void;
  duplicateGroupCount: number;
  onResolveDuplicates?: () => void;
  candidateCount: number;
  onReviewCandidates?: () => void;
};

export function useAutomationHost({
  folder,
  breadcrumbs,
  items,
  filteredItems,
  sysprompt,
  hasCaptionBackup,
  ostrisAvailable,
  comfyPresetsAvailable,
  getJobPaths,
  automation,
  onEditSysprompt,
  issueCount,
  onResolveIssues,
  duplicateGroupCount,
  onResolveDuplicates,
  candidateCount,
  onReviewCandidates,
}: UseAutomationHostOptions) {
  const { startJob } = automation;
  const jobStart = useJobStartConfirmation(folder, breadcrumbs, startJob, getJobPaths);

  // One read, so the count a dialog shows and the paths its job starts with can
  // never disagree. `undefined` means nothing is selected: the job takes the folder.
  const jobPaths = getJobPaths();
  const selectionActive = jobPaths !== undefined;
  const jobItemCount = jobPaths?.length ?? items.length;

  const dialogs = useAutomationDialogOverlays({
    folderPath: folder,
    folderLabel: jobStart.folderLabel,
    startingJobType: automation.startingJobType,
    itemCount: jobItemCount,
    folderItemCount: items.length,
    selectionActive,
    startJob,
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

  const jobAvailability = useMemo<JobAvailability>(
    () => ({ hasCaptionBackup, ostrisAvailable, comfyPresetsAvailable }),
    [comfyPresetsAvailable, hasCaptionBackup, ostrisAvailable],
  );

  const requestStart = useCallback(
    (jobType: JobType) => {
      // The menu already disables these; re-checked so a stale flag cannot start a job.
      if (!isJobAvailable(jobType, jobAvailability)) return;
      if (isConfirmableJobType(jobType)) {
        requestJobStart(jobType);
        return;
      }
      openDialogForJobType(jobType);
    },
    [jobAvailability, openDialogForJobType, requestJobStart],
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
      duplicateGroupCount,
      onResolveDuplicates,
      candidateCount,
      onReviewCandidates,
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
      duplicateGroupCount,
      candidateCount,
      onEditSysprompt,
      onResolveIssues,
      onResolveDuplicates,
      onReviewCandidates,
      requestStart,
      sysprompt,
    ],
  );

  const confirmScope = useMemo<DialogScopeInfo>(
    () => ({ itemCount: jobItemCount, folderLabel, fromSelection: selectionActive }),
    [folderLabel, jobItemCount, selectionActive],
  );

  return {
    panelProps,
    dialogs: automationDialogs,
    jobStartConfirm: {
      pending: pendingJobStart,
      scope: confirmScope,
      onConfirm: confirmPendingJobStart,
      onCancel: cancelPendingJobStart,
    },
  };
}
