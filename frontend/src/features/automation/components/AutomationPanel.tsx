import { useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  iconBan,
  iconCircleCheck,
  iconCircleAlert,
  iconDot,
  iconFileCheck,
  iconFilePen,
  iconFilePlus,
  iconHammer,
  iconLoader2,
  iconScanSquare,
  iconTriangleAlert,
  iconMessageCheck,
} from "@/shared/icons";
import type { GalleryItem, Job, JobType } from "@/shared/types";
import {
  isActiveJobStatus,
  jobErrorMessage,
  jobIsCancelled,
  jobShowsErrorState,
  jobShowsWarningState,
  jobTypeLabel,
  jobWarningMessage,
  progressPercent,
  statusLabel,
} from "@/features/jobs/lib/jobs";
import {
  JOB_TYPE_META,
  PRIMARY_JOB_TYPE,
  jobTypeIconFor,
  jobTypeLabelFor,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import { useAutomationSpecsVisible } from "@/features/automation/hooks/useAutomationSpecsVisible";
import { useTrainingSamples } from "@/features/jobs/hooks/useTrainingSamples";
import { useStickyDockOffset } from "@/shared/hooks/useStickyDockOffset";
import { useStickyFloating } from "@/shared/hooks/useStickyFloating";
import { useJobTimeLabel } from "@/features/jobs/hooks/useJobTimeLabel";
import { classNames } from "@/shared/lib/classNames";
import { AutomationMoreJobsMenu } from "./AutomationMoreJobsMenu";
import { AutomationSystemSpecs } from "./AutomationSystemSpecs";
import { JobFileResults } from "@/features/jobs/components/JobFileResults";
import { ComfyProcessLog } from "@/features/automation/components/ComfyProcessLog";
import { TrainingSamples } from "@/features/jobs/components/TrainingSamples";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

/** The status icon for a job, or null while no icon applies. Order decides precedence. */
function jobStatusIcon(job: Job): { icon: LucideIcon; className: string } | null {
  if (isActiveJobStatus(job.status)) {
    return { icon: iconLoader2, className: "automation__status-icon--spin" };
  }
  if (jobShowsErrorState(job)) {
    return { icon: iconCircleAlert, className: "automation__status-icon--error" };
  }
  if (jobIsCancelled(job)) {
    return { icon: iconBan, className: "automation__status-icon--cancelled" };
  }
  if (jobShowsWarningState(job)) {
    return { icon: iconTriangleAlert, className: "automation__status-icon--warning" };
  }
  if (job.status === "completed") {
    return { icon: iconCircleCheck, className: "automation__status-icon--success" };
  }
  return null;
}

export interface AutomationPanelProps {
  filteredItems: GalleryItem[];
  job: Job | null;
  startingJobType: JobType | null;
  canStart: boolean;
  hasSyspromptFile: boolean;
  /** The folder's own .captionrules; a parent's file does not count. */
  hasCaptionRulesFile: boolean;
  /** A non-empty .sysprompt reaches this folder, its own or a parent's. */
  syspromptApplies: boolean;
  /** Folder state that decides which secondary jobs can be started. */
  jobAvailability: JobAvailability;
  onEditSysprompt: () => void;
  onRequestStart: (jobType: JobType) => void;
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (jobType: JobType, paths: string[]) => void;
  onRunAgain?: (jobType: JobType) => void;
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

export function AutomationPanel({
  filteredItems,
  job,
  startingJobType,
  canStart,
  hasSyspromptFile,
  hasCaptionRulesFile,
  syspromptApplies,
  jobAvailability,
  onEditSysprompt,
  onRequestStart,
  onOpenItem,
  onRetryFailed,
  onRunAgain,
  onCancelJob,
  cancellingJob = false,
  issueCount = 0,
  onResolveIssues,
  duplicateGroupCount = 0,
  onResolveDuplicates,
  candidateCount = 0,
  onReviewCandidates,
}: AutomationPanelProps) {
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useStickyDockOffset(panelRef);
  const isFloating = useStickyFloating(stickySentinelRef, panelRef);
  const jobActive = job ? isActiveJobStatus(job.status) : false;
  const starting = startingJobType !== null;
  const startingPrimary = startingJobType === PRIMARY_JOB_TYPE;
  const primaryMeta = JOB_TYPE_META[PRIMARY_JOB_TYPE];
  const primaryLabel = jobTypeLabelFor(PRIMARY_JOB_TYPE);
  const showResolveIssues = issueCount > 0 && Boolean(onResolveIssues);
  const showResolveDuplicates = duplicateGroupCount > 0 && Boolean(onResolveDuplicates);
  const showReviewCandidates = candidateCount > 0 && Boolean(onReviewCandidates);
  const { showSpecs, toggleSpecs } = useAutomationSpecsVisible();
  const specsPanelId = useId();

  const showJobError = job ? jobShowsErrorState(job) : false;
  const showJobWarning = job ? jobShowsWarningState(job) : false;
  const showCancelled = job ? jobIsCancelled(job) : false;
  const errorMessage = job ? jobErrorMessage(job) : null;
  const warningMessage = job ? jobWarningMessage(job) : null;
  const timeLabel = useJobTimeLabel(job);
  const statusIcon = job ? jobStatusIcon(job) : null;
  const trainingSamples = useTrainingSamples(job);
  const issueLabel = `${issueCount} caption ${issueCount === 1 ? "issue" : "issues"}`;
  const duplicateLabel = `${duplicateGroupCount} duplicate ${
    duplicateGroupCount === 1 ? "group" : "groups"
  }`;
  const candidateLabel = `${candidateCount} ${candidateCount === 1 ? "candidate" : "candidates"}`;
  const jobLabel = job ? jobTypeLabel(job).toLowerCase() : "";

  const startTooltip = startingPrimary
    ? `Starting ${primaryLabel.toLowerCase()} job...`
    : starting
      ? "Another job is starting..."
      : !syspromptApplies
        ? "Write a system prompt in the folder instructions to enable auto-captioning"
        : (primaryMeta.menuDescription ?? `Start ${primaryLabel.toLowerCase()}`);
  const hasInstructions = hasSyspromptFile || hasCaptionRulesFile;
  const syspromptTooltip = hasInstructions
    ? "Edit the system prompt and caption rules for this folder"
    : "Create a system prompt or caption rules for this folder";

  return (
    <>
      <div ref={stickySentinelRef} className="sticky-sentinel" aria-hidden="true" />
      <section
        ref={panelRef}
        className={classNames("automation", isFloating && "automation--floating")}
        aria-label="Automation"
      >
        <div className="automation__header">
          <div className="automation__title">
            <Icon icon={iconHammer} className="automation__title-icon" />
            <span>Automation</span>
          </div>

          <div className="automation__actions">
            {!jobActive && (
              <>
                <Tooltip content={syspromptTooltip}>
                  <button
                    type="button"
                    className="automation__sysprompt"
                    onClick={onEditSysprompt}
                    aria-label={hasInstructions ? "Edit instructions" : "Create instructions"}
                  >
                    <Icon
                      icon={hasInstructions ? iconFilePen : iconFilePlus}
                      className="automation__btn-icon"
                    />
                    {hasInstructions ? "Edit instructions" : "Create instructions"}
                  </button>
                </Tooltip>

                {canStart && (
                  <Tooltip content={startTooltip}>
                    <button
                      type="button"
                      className="automation__start"
                      onClick={() => onRequestStart(PRIMARY_JOB_TYPE)}
                      disabled={starting || filteredItems.length === 0 || !syspromptApplies}
                    >
                      {startingPrimary ? (
                        <>
                          <Icon
                            icon={iconLoader2}
                            className="automation__btn-icon automation__btn-icon--spin"
                          />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Icon
                            icon={jobTypeIconFor(PRIMARY_JOB_TYPE)}
                            className="automation__btn-icon"
                          />
                          {primaryLabel}
                        </>
                      )}
                    </button>
                  </Tooltip>
                )}

                {canStart && (
                  <AutomationMoreJobsMenu
                    disabled={starting || filteredItems.length === 0}
                    startingJobType={startingJobType}
                    availability={jobAvailability}
                    onRequestStart={onRequestStart}
                  />
                )}
              </>
            )}

            {jobActive && job && (
              <Tooltip
                content={cancellingJob ? `Cancelling ${jobLabel} job...` : `Cancel ${jobLabel} job`}
              >
                <button
                  type="button"
                  className="automation__cancel"
                  onClick={onCancelJob}
                  disabled={cancellingJob}
                  aria-label="Cancel running job"
                >
                  <Icon
                    icon={cancellingJob ? iconLoader2 : iconBan}
                    className={classNames(
                      "automation__btn-icon",
                      cancellingJob && "automation__btn-icon--spin",
                    )}
                  />
                  Cancel
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {job && (
          <div className="automation__body">
            <div className="automation__status-row">
              <span className="automation__status">
                {statusIcon && (
                  <Icon
                    icon={statusIcon.icon}
                    className={`automation__status-icon ${statusIcon.className}`}
                  />
                )}
                <span className="automation__job-type">{jobTypeLabel(job)}</span>
                <span className="automation__status-label">{statusLabel(job)}</span>
              </span>
              <span className="automation__counts">
                {job.processed}/{job.total || "..."}
                {timeLabel && (
                  <span className="automation__remaining">
                    <Icon icon={iconDot} className="app-icon--dot" />
                    {timeLabel}
                  </span>
                )}
              </span>
            </div>

            {jobActive && job.current_name && (
              <p className="automation__current-file" title={job.current_name}>
                {job.current_name}
              </p>
            )}

            {jobActive && (
              <div
                className="automation__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent(job)}
                aria-label={`${jobTypeLabel(job)} progress`}
              >
                <div
                  className={classNames(
                    "automation__progress-bar",
                    showJobError && "automation__progress-bar--error",
                    showJobWarning && "automation__progress-bar--warning",
                    showCancelled && "automation__progress-bar--cancelled",
                  )}
                  style={{ width: `${progressPercent(job)}%` }}
                />
              </div>
            )}

            {errorMessage && (
              <div className="automation__message automation__message--error" role="alert">
                <Icon icon={iconCircleAlert} className="automation__message-icon" />
                <span>{errorMessage}</span>
              </div>
            )}

            {warningMessage && (
              <div className="automation__message automation__message--warning" role="status">
                <Icon icon={iconTriangleAlert} className="automation__message-icon" />
                <span>{warningMessage}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="automation-details" aria-label="Automation details">
        {!jobActive && (showResolveIssues || showResolveDuplicates || showReviewCandidates) && (
          <div className="automation__review" role="group" aria-label="Ready to review">
            <span className="automation__review-label">Ready to review</span>
            {showResolveIssues && (
              <Tooltip content={`Review and fix ${issueLabel}`}>
                <button
                  type="button"
                  className="automation__resolve-issues"
                  onClick={onResolveIssues}
                  disabled={starting}
                  aria-label={`Resolve ${issueLabel}`}
                >
                  <Icon icon={iconMessageCheck} className="automation__btn-icon" />
                  {issueLabel}
                </button>
              </Tooltip>
            )}

            {showResolveDuplicates && (
              <Tooltip content={`Compare and clear ${duplicateLabel}`}>
                <button
                  type="button"
                  className="automation__resolve-duplicates"
                  onClick={onResolveDuplicates}
                  disabled={starting}
                  aria-label={`Resolve ${duplicateLabel}`}
                >
                  <Icon icon={iconFileCheck} className="automation__btn-icon" />
                  {duplicateLabel}
                </button>
              </Tooltip>
            )}

            {showReviewCandidates && (
              <Tooltip
                content={`Compare ${candidateLabel} against the original${candidateCount === 1 ? "" : "s"}`}
              >
                <button
                  type="button"
                  className="automation__review-candidates"
                  onClick={onReviewCandidates}
                  disabled={starting}
                  aria-label={`Review ${candidateLabel}`}
                >
                  <Icon icon={iconScanSquare} className="automation__btn-icon" />
                  {candidateLabel}
                </button>
              </Tooltip>
            )}
          </div>
        )}
        {job && (
          <>
            <TrainingSamples samples={trainingSamples} />
            <ComfyProcessLog key={`log-${job.id}`} job={job} />
            <JobFileResults
              key={`results-${job.id}`}
              job={job}
              onOpenItem={onOpenItem}
              onRetryFailed={onRetryFailed && ((paths) => onRetryFailed(job.job_type, paths))}
              onRunAgain={onRunAgain && (() => onRunAgain(job.job_type))}
            />
          </>
        )}
        <AutomationSystemSpecs
          id={specsPanelId}
          open={showSpecs}
          jobActive={jobActive}
          onToggle={toggleSpecs}
        />
      </section>
    </>
  );
}
