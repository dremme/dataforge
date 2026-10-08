import type { JobStartContext } from "@/features/jobs/lib/jobMeta";
import type { Job, JobType } from "@/shared/types";

/** Folder automation state and handlers shared by the workspace actions and quick actions. */
export interface AutomationActions {
  job: Job | null;
  startingJobType: JobType | null;
  /** Everything that decides whether a job can start; read through `jobStartBlock`. */
  startContext: JobStartContext;
  hasSyspromptFile: boolean;
  /** The folder's own .captionrules; a parent's file does not count. */
  hasCaptionRulesFile: boolean;
  onEditSysprompt: () => void;
  onRequestStart: (jobType: JobType) => void;
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (jobType: JobType, paths: string[]) => void;
  onCancelJob: () => void;
  cancellingJob?: boolean;
  issueCount?: number;
  onResolveIssues?: () => void;
  /** Groups, not files: the resolver steps through one group at a time. */
  duplicateGroupCount?: number;
  onResolveDuplicates?: () => void;
  /** Files with a ComfyUI candidate waiting. The review queue walks one pair at a time. */
  candidateCount?: number;
  /** Opens the before/after queue for this folder's ComfyUI candidates. */
  onReviewCandidates?: () => void;
}
