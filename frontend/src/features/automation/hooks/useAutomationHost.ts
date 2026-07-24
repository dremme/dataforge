import { useCallback, useMemo } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import { useAutomationDialogOverlays } from "@/features/automation/hooks/useAutomationDialogOverlays";
import type { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useJobStartConfirmation } from "@/features/jobs/hooks/useJobStartConfirmation";
import { isConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { Breadcrumb, GalleryItem, JobType } from "@/shared/types";

type FolderAutomation = ReturnType<typeof useFolderAutomation>;

type UseAutomationHostOptions = {
  folder: string | undefined;
  breadcrumbs: Breadcrumb[];
  items: GalleryItem[];
  filteredItems: GalleryItem[];
  sysprompt: GalleryItem | null;
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

  const requestStart = useCallback(
    (jobType: JobType) => {
      if (isConfirmableJobType(jobType)) {
        requestJobStart(jobType);
        return;
      }
      openDialogForJobType(jobType);
    },
    [openDialogForJobType, requestJobStart],
  );

  const panelProps = useMemo<AutomationPanelProps>(
    () => ({
      filteredItems,
      job: automation.folderJob,
      startingJobType: automation.startingJobType,
      canStart: !automation.folderHasActiveJob,
      hasSyspromptFile: Boolean(sysprompt),
      hasSyspromptContent: sysprompt?.has_description ?? false,
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
