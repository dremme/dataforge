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
import { quickActionRunJobId } from "@/features/quickAction/lib/buildQuickActionItems";
import { touchRecentAction } from "@/features/quickAction/lib/quickActionHistory";
import type { Breadcrumb, GalleryItem, JobType } from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

type FolderAutomation = ReturnType<typeof useFolderAutomation>;

type UseAutomationHostOptions = {
  folder: string | undefined;
  breadcrumbs: Breadcrumb[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  hasSysprompt: boolean;
  syspromptApplies: boolean;
  hasCaptionRules: boolean;
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
  comfyPresetsAvailable: boolean;
  getJobPaths: () => string[] | undefined;
  automation: FolderAutomation;
  onEditSysprompt: () => void;
  onEditCaptionRules: () => void;
  issueCount: number;
  onResolveIssues?: () => void;
  duplicateGroupCount: number;
  onResolveDuplicates?: () => void;
  candidateCount: number;
  onReviewCandidates?: () => void;
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (jobType: JobType, paths: string[]) => void;
  onRunAgain?: (jobType: JobType) => void;
};

export function useAutomationHost({
  folder,
  breadcrumbs,
  items,
  filteredItems,
  hasSysprompt,
  syspromptApplies,
  hasCaptionRules,
  hasCaptionBackup,
  ostrisAvailable,
  comfyPresetsAvailable,
  getJobPaths,
  automation,
  onEditSysprompt,
  onEditCaptionRules,
  issueCount,
  onResolveIssues,
  duplicateGroupCount,
  onResolveDuplicates,
  candidateCount,
  onReviewCandidates,
  onOpenItem,
  onRetryFailed,
  onRunAgain,
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
    onEditCaptionRules,
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
      touchRecentAction(quickActionRunJobId(jobType));
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
      hasSyspromptFile: hasSysprompt,
      hasCaptionRulesFile: hasCaptionRules,
      syspromptApplies,
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
      onOpenItem,
      onRetryFailed,
      onRunAgain,
    }),
    [
      automation.cancelFolderJob,
      automation.cancellingJob,
      automation.folderHasActiveJob,
      automation.folderJob,
      automation.startingJobType,
      filteredItems,
      hasCaptionRules,
      jobAvailability,
      issueCount,
      duplicateGroupCount,
      candidateCount,
      onEditSysprompt,
      onResolveIssues,
      onResolveDuplicates,
      onReviewCandidates,
      onOpenItem,
      onRetryFailed,
      onRunAgain,
      requestStart,
      hasSysprompt,
      syspromptApplies,
    ],
  );

  const confirmScope = useMemo<DialogScopeInfo>(
    () => ({ itemCount: jobItemCount, folderLabel, fromSelection: selectionActive }),
    [folderLabel, jobItemCount, selectionActive],
  );

  return {
    panelProps,
    requestStart,
    dialogs: automationDialogs,
    jobStartConfirm: {
      pending: pendingJobStart,
      scope: confirmScope,
      onConfirm: confirmPendingJobStart,
      onCancel: cancelPendingJobStart,
    },
  };
}
