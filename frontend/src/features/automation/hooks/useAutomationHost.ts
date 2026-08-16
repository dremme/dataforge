import { useCallback, useMemo } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import { useAutomationDialogOverlays } from "@/features/automation/hooks/useAutomationDialogOverlays";
import type { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import type { CaptionFilter } from "@/features/gallery/lib/query";
import { useJobStartConfirmation } from "@/features/jobs/hooks/useJobStartConfirmation";
import {
  isConfirmableJobType,
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
  filter: CaptionFilter;
  onFilterChange: (filter: CaptionFilter) => void;
  sysprompt: GalleryItem | null;
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
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
  filter,
  onFilterChange,
  sysprompt,
  hasCaptionBackup,
  ostrisAvailable,
  getJobPaths,
  automation,
  onEditSysprompt,
  issueCount,
  onResolveIssues,
}: UseAutomationHostOptions) {
  const { startJob } = automation;
  const jobStart = useJobStartConfirmation(folder, breadcrumbs, startJob, getJobPaths);

  const dialogs = useAutomationDialogOverlays({
    folderPath: folder,
    folderLabel: jobStart.folderLabel,
    startingJobType: automation.startingJobType,
    itemCount: getJobPaths()?.length ?? items.length,
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
    () => ({ hasCaptionBackup, ostrisAvailable }),
    [hasCaptionBackup, ostrisAvailable],
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
      items,
      filter,
      onFilterChange,
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
      filter,
      filteredItems,
      items,
      jobAvailability,
      issueCount,
      onEditSysprompt,
      onFilterChange,
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
