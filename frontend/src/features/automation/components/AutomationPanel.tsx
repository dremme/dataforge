import { useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  iconAlertTriangle,
  iconBan,
  iconChartBar,
  iconCircleCheck,
  iconCircleAlert,
  iconDot,
  iconFilePen,
  iconFilePlus,
  iconHammer,
  iconInfo,
  iconLoader2,
  iconTriangleAlert,
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
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import { useAutomationSpecsVisible } from "@/features/automation/hooks/useAutomationSpecsVisible";
import { useDatasetStatsVisible } from "@/features/automation/hooks/useDatasetStatsVisible";
import type { CaptionFilter } from "@/features/gallery/lib/query";
import { useTrainingSamples } from "@/features/jobs/hooks/useTrainingSamples";
import { useStickyDockOffset } from "@/shared/hooks/useStickyDockOffset";
import { useStickyFloating } from "@/shared/hooks/useStickyFloating";
import { useJobTimeLabel } from "@/features/jobs/hooks/useJobTimeLabel";
import { classNames } from "@/shared/lib/classNames";
import { AutomationMoreJobsMenu } from "./AutomationMoreJobsMenu";
import { AutomationSystemSpecs } from "./AutomationSystemSpecs";
import { AutomationStatsPanel } from "./AutomationStatsPanel";
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
  /** Every item in the folder; the stats panel summarizes the dataset, not the view. */
  items: GalleryItem[];
  filter: CaptionFilter;
  onFilterChange: (filter: CaptionFilter) => void;
  job: Job | null;
  startingJobType: JobType | null;
  canStart: boolean;
  hasSyspromptFile: boolean;
  hasSyspromptContent: boolean;
  /** Folder state that decides which secondary jobs can be started. */
  jobAvailability: JobAvailability;
  onEditSysprompt: () => void;
  onRequestStart: (jobType: JobType) => void;
  onCancelJob: () => void;
  cancellingJob?: boolean;
  issueCount?: number;
  onResolveIssues?: () => void;
}

export function AutomationPanel({
  filteredItems,
  items,
  filter,
  onFilterChange,
  job,
  startingJobType,
  canStart,
  hasSyspromptFile,
  hasSyspromptContent,
  jobAvailability,
  onEditSysprompt,
  onRequestStart,
  onCancelJob,
  cancellingJob = false,
  issueCount = 0,
  onResolveIssues,
}: AutomationPanelProps) {
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useStickyDockOffset(panelRef);
  const isFloating = useStickyFloating(stickySentinelRef, panelRef);
  const jobActive = job ? isActiveJobStatus(job.status) : false;
  const starting = startingJobType !== null;
  const startingPrimary = startingJobType === PRIMARY_JOB_TYPE;
  const primaryMeta = JOB_TYPE_META[PRIMARY_JOB_TYPE];
  const showResolveIssues = issueCount > 0 && Boolean(onResolveIssues);
  const { showSpecs, toggleSpecs } = useAutomationSpecsVisible();
  const specsPanelId = useId();
  const { showStats, toggleStats } = useDatasetStatsVisible();
  const statsPanelId = useId();

  const showJobError = job ? jobShowsErrorState(job) : false;
  const showJobWarning = job ? jobShowsWarningState(job) : false;
  const showCancelled = job ? jobIsCancelled(job) : false;
  const errorMessage = job ? jobErrorMessage(job) : null;
  const warningMessage = job ? jobWarningMessage(job) : null;
  const timeLabel = useJobTimeLabel(job);
  const statusIcon = job ? jobStatusIcon(job) : null;
  const trainingSamples = useTrainingSamples(job);
  const issueLabel = `${issueCount} caption ${issueCount === 1 ? "issue" : "issues"}`;
  const jobLabel = job ? jobTypeLabel(job).toLowerCase() : "";

  const startTooltip = startingPrimary
    ? `Starting ${primaryMeta.label.toLowerCase()} job...`
    : starting
      ? "Another job is starting..."
      : !hasSyspromptFile
        ? "Add a .sysprompt file to enable auto-captioning"
        : !hasSyspromptContent
          ? "Write instructions in .sysprompt before running auto-caption"
          : (primaryMeta.menuDescription ?? `Start ${primaryMeta.label.toLowerCase()}`);
  const specsTooltip = showSpecs ? "Hide system specifications" : "Show system specifications";
  const statsTooltip = showStats ? "Hide dataset statistics" : "Show dataset statistics";
  const syspromptTooltip = hasSyspromptFile
    ? "Edit the .sysprompt instructions for this folder"
    : "Create a .sysprompt file with captioning instructions";

  return (
    <>
      <div ref={stickySentinelRef} className="sticky-sentinel" aria-hidden="true" />
      <section
        ref={panelRef}
        className={classNames(
          "automation",
          isFloating && "automation--floating",
          showJobError && "automation--error",
          showJobWarning && "automation--warning",
          showCancelled && "automation--cancelled",
        )}
        aria-label="Automation"
      >
        <div className="automation__header">
          <div className="automation__title">
            <Icon icon={iconHammer} className="automation__title-icon" />
            <span>DataForge automation</span>
            <Tooltip content={specsTooltip}>
              <button
                type="button"
                className={classNames(
                  "automation__specs-toggle",
                  showSpecs && "automation__specs-toggle--active",
                )}
                onClick={toggleSpecs}
                aria-label="Toggle system specifications"
                aria-expanded={showSpecs}
                aria-controls={specsPanelId}
              >
                <Icon icon={iconInfo} />
              </button>
            </Tooltip>
            <Tooltip content={statsTooltip}>
              <button
                type="button"
                className={classNames(
                  "automation__specs-toggle",
                  showStats && "automation__specs-toggle--active",
                )}
                onClick={toggleStats}
                aria-label="Toggle dataset statistics"
                aria-expanded={showStats}
                aria-controls={statsPanelId}
              >
                <Icon icon={iconChartBar} />
              </button>
            </Tooltip>
          </div>

          <div className="automation__actions">
            {!jobActive && (
              <>
                <Tooltip content={syspromptTooltip}>
                  <button
                    type="button"
                    className="automation__sysprompt"
                    onClick={onEditSysprompt}
                    aria-label={hasSyspromptFile ? "Edit instructions" : "Create instructions"}
                  >
                    <Icon
                      icon={hasSyspromptFile ? iconFilePen : iconFilePlus}
                      className="automation__btn-icon"
                    />
                    {hasSyspromptFile ? "Edit instructions" : "Create instructions"}
                  </button>
                </Tooltip>

                {canStart && (
                  <Tooltip content={startTooltip}>
                    <button
                      type="button"
                      className="automation__start"
                      onClick={() => onRequestStart(PRIMARY_JOB_TYPE)}
                      disabled={starting || filteredItems.length === 0 || !hasSyspromptContent}
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
                          {primaryMeta.label}
                        </>
                      )}
                    </button>
                  </Tooltip>
                )}

                {showResolveIssues && (
                  <Tooltip content={`Review and fix ${issueLabel}`}>
                    <button
                      type="button"
                      className="automation__resolve-issues"
                      onClick={onResolveIssues}
                      disabled={starting}
                      aria-label={`Resolve ${issueLabel}`}
                    >
                      <Icon icon={iconAlertTriangle} className="automation__btn-icon" />
                      Resolve issues
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

        <AutomationSystemSpecs id={specsPanelId} open={showSpecs} />

        <AutomationStatsPanel
          id={statsPanelId}
          open={showStats}
          items={items}
          filter={filter}
          onFilterChange={onFilterChange}
        />

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

            <TrainingSamples samples={trainingSamples} />

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
    </>
  );
}
