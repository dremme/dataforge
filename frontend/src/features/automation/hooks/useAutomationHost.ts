import { useCallback, useMemo, useState } from "react";
import type { BulkScopeKind } from "@/features/automation/lib/bulkScope";
import type { AutomationActions } from "@/features/automation/lib/automationActions";
import { useAutomationDialogOverlays } from "@/features/automation/hooks/useAutomationDialogOverlays";
import type { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useJobStartConfirmation } from "@/features/jobs/hooks/useJobStartConfirmation";
import {
  isConfirmableJobType,
  jobStartBlock,
  type JobAvailability,
  type JobStartContext,
} from "@/features/jobs/lib/jobMeta";
import { quickActionRunJobId } from "@/features/quickAction/lib/buildQuickActionItems";
import { touchRecentAction } from "@/features/quickAction/lib/quickActionHistory";
import type { Breadcrumb, GalleryItem, JobType } from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";

type FolderAutomation = ReturnType<typeof useFolderAutomation>;

type UseAutomationHostOptions = {
  folder: string | undefined;
  breadcrumbs: Breadcrumb[];
  items: GalleryItem[];
  hasSysprompt: boolean;
  syspromptApplies: boolean;
  hasCaptionRules: boolean;
  hasCaptionBackup: boolean;
  ostrisAvailable: boolean;
  comfyPresetsAvailable: boolean;
  getJobPaths: () => string[] | undefined;
  jobScopeKind?: BulkScopeKind;
  requestTransition?: WorkspaceTransition;
  automation: FolderAutomation;
  onEditSysprompt: () => void;
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
  hasSysprompt,
  syspromptApplies,
  hasCaptionRules,
  hasCaptionBackup,
  ostrisAvailable,
  comfyPresetsAvailable,
  getJobPaths,
  jobScopeKind,
  requestTransition,
  automation,
  onEditSysprompt,
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

  // Explicit paths distinguish matching results from the training folder exception.
  const jobPaths = getJobPaths();
  const scopeKind = jobScopeKind ?? (jobPaths !== undefined ? "selected" : "folder");
  const jobItemCount = jobPaths?.length ?? items.length;
  const liveScope = useMemo<DialogScopeInfo>(
    () => ({ itemCount: jobItemCount, folderLabel: jobStart.folderLabel, kind: scopeKind }),
    [jobItemCount, jobStart.folderLabel, scopeKind],
  );
  const [pendingScope, setPendingScope] = useState<DialogScopeInfo | null>(null);

  const dialogs = useAutomationDialogOverlays({
    folderPath: folder,
    folderLabel: jobStart.folderLabel,
    startingJobType: automation.startingJobType,
    itemCount: jobItemCount,
    folderItemCount: items.length,
    scopeKind,
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

  const startContext = useMemo<JobStartContext>(
    () => ({
      hasFolder: Boolean(folder),
      canStart: !automation.folderHasActiveJob,
      starting: automation.startingJobType !== null,
      itemCount: jobItemCount,
      folderCount: items.length,
      syspromptApplies,
      availability: jobAvailability,
    }),
    [
      automation.folderHasActiveJob,
      automation.startingJobType,
      folder,
      items.length,
      jobAvailability,
      jobItemCount,
      syspromptApplies,
    ],
  );

  const requestStart = useCallback(
    (jobType: JobType, explicitPaths?: string[], explicitKind?: BulkScopeKind) => {
      // Every trigger already disables blocked jobs; re-checked so a stale flag cannot start one.
      const paths = explicitPaths ?? getJobPaths();
      const itemCount = paths?.length ?? items.length;
      if (jobStartBlock(jobType, { ...startContext, itemCount }).blocked) return;
      const targetScope = {
        ...liveScope,
        itemCount: paths?.length ?? liveScope.itemCount,
        kind: explicitKind ?? liveScope.kind,
      };
      const open = () => {
        touchRecentAction(quickActionRunJobId(jobType));
        if (isConfirmableJobType(jobType)) {
          setPendingScope(targetScope);
          requestJobStart(jobType, paths);
          return;
        }
        openDialogForJobType(jobType, { scope: targetScope, paths });
      };
      if (requestTransition) void requestTransition(open);
      else open();
    },
    [
      getJobPaths,
      items.length,
      liveScope,
      openDialogForJobType,
      requestJobStart,
      requestTransition,
      startContext,
    ],
  );

  const actions = useMemo<AutomationActions>(
    () => ({
      job: automation.folderJob,
      startingJobType: automation.startingJobType,
      startContext,
      hasSyspromptFile: hasSysprompt,
      hasCaptionRulesFile: hasCaptionRules,
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
      automation.folderJob,
      automation.startingJobType,
      startContext,
      hasCaptionRules,
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
    ],
  );

  const confirmScope = useMemo<DialogScopeInfo>(
    () => pendingScope ?? { itemCount: jobItemCount, folderLabel, kind: scopeKind },
    [folderLabel, jobItemCount, pendingScope, scopeKind],
  );

  return {
    actions,
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
