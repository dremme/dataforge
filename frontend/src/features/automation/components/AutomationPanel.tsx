import { useId, useRef } from "react";
import {
  iconAlertTriangle,
  iconBan,
  iconCircleCheck,
  iconCircleAlert,
  iconCpu,
  iconFilePen,
  iconFilePlus,
  iconGpu,
  iconHammer,
  iconInfo,
  iconLoader2,
  iconMemoryStick,
  iconPencilSparkles,
  iconTriangleAlert,
} from "@/shared/icons";
import type { GalleryItem, Job } from "@/shared/types";
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
import { useAutomationSpecsVisible } from "@/features/automation/hooks/useAutomationSpecsVisible";
import { useStickyFloating } from "@/shared/hooks/useStickyFloating";
import { useJobRemainingTime } from "@/features/jobs/hooks/useJobRemainingTime";
import { useSystemSpecs } from "@/features/automation/hooks/useSystemSpecs";
import { classNames } from "@/shared/lib/classNames";
import { formatBytes } from "@/shared/lib/format";
import { AutomationMoreJobsMenu } from "./AutomationMoreJobsMenu";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface AutomationPanelProps {
  filteredItems: GalleryItem[];
  job: Job | null;
  startingAutoCaption: boolean;
  startingBodyParts: boolean;
  startingStripMetadata: boolean;
  startingSetCaptions: boolean;
  startingVerifyCaptions: boolean;
  startingBatchRename: boolean;
  canStart: boolean;
  hasSyspromptFile: boolean;
  hasSyspromptContent: boolean;
  onEditSysprompt: () => void;
  onStartAutoCaption: () => void;
  onStartBodyParts: () => void;
  onStartStripMetadata: () => void;
  onStartSetCaptions: () => void;
  onStartVerifyCaptions: () => void;
  onStartBatchRename: () => void;
  onCancelJob: () => void;
  cancellingJob?: boolean;
  issueCount?: number;
  onResolveIssues?: () => void;
}

export function AutomationPanel({
  filteredItems,
  job,
  startingAutoCaption,
  startingBodyParts,
  startingStripMetadata,
  startingSetCaptions,
  startingVerifyCaptions,
  startingBatchRename,
  canStart,
  hasSyspromptFile,
  hasSyspromptContent,
  onEditSysprompt,
  onStartAutoCaption,
  onStartBodyParts,
  onStartStripMetadata,
  onStartSetCaptions,
  onStartVerifyCaptions,
  onStartBatchRename,
  onCancelJob,
  cancellingJob = false,
  issueCount = 0,
  onResolveIssues,
}: AutomationPanelProps) {
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const isFloating = useStickyFloating(stickySentinelRef);
  const jobActive = job ? isActiveJobStatus(job.status) : false;
  const starting =
    startingAutoCaption ||
    startingBodyParts ||
    startingStripMetadata ||
    startingSetCaptions ||
    startingVerifyCaptions ||
    startingBatchRename;
  const showResolveIssues = issueCount > 0 && Boolean(onResolveIssues);
  const { showSpecs, toggleSpecs } = useAutomationSpecsVisible();
  const specsPanelId = useId();

  const showJobError = job ? jobShowsErrorState(job) : false;
  const showJobWarning = job ? jobShowsWarningState(job) : false;
  const showCancelled = job ? jobIsCancelled(job) : false;
  const errorMessage = job ? jobErrorMessage(job) : null;
  const warningMessage = job ? jobWarningMessage(job) : null;
  const remainingTime = useJobRemainingTime(job);
  const systemSpecs = useSystemSpecs();

  const startTooltip = startingAutoCaption
    ? "Starting auto-caption job..."
    : starting
      ? "Another job is starting..."
      : !hasSyspromptFile
        ? "Add a .sysprompt file to enable auto-captioning"
        : !hasSyspromptContent
          ? "Write instructions in .sysprompt before running auto-caption"
          : "Auto-complete captions with the local model";
  const specsTooltip = showSpecs ? "Hide system specifications" : "Show system specifications";
  const syspromptTooltip = hasSyspromptFile
    ? "Edit the .sysprompt instructions for this folder"
    : "Create a .sysprompt file with captioning instructions";

  return (
    <>
      <div ref={stickySentinelRef} className="automation-sentinel" aria-hidden="true" />
      <section
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
                className={`automation__specs-toggle${showSpecs ? " automation__specs-toggle--active" : ""}`}
                onClick={toggleSpecs}
                aria-label="Toggle system specifications"
                aria-expanded={showSpecs}
                aria-controls={specsPanelId}
              >
                <Icon icon={iconInfo} />
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
                      onClick={onStartAutoCaption}
                      disabled={starting || filteredItems.length === 0 || !hasSyspromptContent}
                    >
                      {startingAutoCaption ? (
                        <>
                          <Icon
                            icon={iconLoader2}
                            className="automation__btn-icon automation__btn-icon--spin"
                          />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Icon icon={iconPencilSparkles} className="automation__btn-icon" />
                          Auto-caption
                        </>
                      )}
                    </button>
                  </Tooltip>
                )}

                {showResolveIssues && (
                  <Tooltip
                    content={`Review and fix ${issueCount} caption ${issueCount === 1 ? "issue" : "issues"}`}
                  >
                    <button
                      type="button"
                      className="automation__resolve-issues"
                      onClick={onResolveIssues}
                      disabled={starting}
                      aria-label={`Resolve ${issueCount} caption ${issueCount === 1 ? "issue" : "issues"}`}
                    >
                      <Icon icon={iconAlertTriangle} className="automation__btn-icon" />
                      Resolve issues
                    </button>
                  </Tooltip>
                )}

                {canStart && (
                  <AutomationMoreJobsMenu
                    disabled={starting || filteredItems.length === 0}
                    startingBodyParts={startingBodyParts}
                    startingStripMetadata={startingStripMetadata}
                    startingSetCaptions={startingSetCaptions}
                    startingVerifyCaptions={startingVerifyCaptions}
                    startingBatchRename={startingBatchRename}
                    onStartBodyParts={onStartBodyParts}
                    onStartStripMetadata={onStartStripMetadata}
                    onStartSetCaptions={onStartSetCaptions}
                    onStartVerifyCaptions={onStartVerifyCaptions}
                    onStartBatchRename={onStartBatchRename}
                  />
                )}
              </>
            )}

            {jobActive && job && (
              <Tooltip
                content={
                  cancellingJob
                    ? `Cancelling ${jobTypeLabel(job).toLowerCase()} job...`
                    : `Cancel ${jobTypeLabel(job).toLowerCase()} job`
                }
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
                    className={`automation__btn-icon${cancellingJob ? " automation__btn-icon--spin" : ""}`}
                  />
                  Cancel
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {systemSpecs && (
          <div
            id={specsPanelId}
            className={classNames(
              "automation__specs-panel",
              showSpecs && "automation__specs-panel--open",
            )}
          >
            <div className="automation__specs-panel-inner">
              <div className="automation__specs" role="region" aria-label="System specifications">
                <span className="automation__spec">
                  <Icon icon={iconCpu} className="automation__spec-icon" />
                  <span className="automation__spec-label">
                    {systemSpecs.cpu_name}
                    <span className="automation__spec-detail">
                      {" "}
                      · {systemSpecs.cpu_cores} cores
                    </span>
                  </span>
                </span>
                <span className="automation__spec-divider" aria-hidden="true" />
                <span className="automation__spec">
                  <Icon icon={iconMemoryStick} className="automation__spec-icon" />
                  <span className="automation__spec-label">
                    RAM {formatBytes(systemSpecs.memory_available_bytes)}
                    <span className="automation__spec-detail">
                      {" "}
                      / {formatBytes(systemSpecs.memory_total_bytes)}
                    </span>
                  </span>
                </span>
                <span className="automation__spec-divider" aria-hidden="true" />
                <span className="automation__spec">
                  <Icon icon={iconGpu} className="automation__spec-icon" />
                  <span className="automation__spec-label">
                    {systemSpecs.gpu_available && systemSpecs.gpu_name ? (
                      <>
                        {systemSpecs.gpu_name}
                        {systemSpecs.gpu_memory_bytes && (
                          <span className="automation__spec-detail">
                            {" "}
                            · {formatBytes(systemSpecs.gpu_memory_bytes)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="automation__spec-detail">No GPU</span>
                    )}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {job && (
          <div className="automation__body">
            <div className="automation__status-row">
              <span className="automation__status">
                {jobActive && (
                  <Icon
                    icon={iconLoader2}
                    className="automation__status-icon automation__status-icon--spin"
                  />
                )}
                {!jobActive && job.status === "completed" && !showJobError && !showJobWarning && (
                  <Icon
                    icon={iconCircleCheck}
                    className="automation__status-icon automation__status-icon--success"
                  />
                )}
                {!jobActive && showJobWarning && (
                  <Icon
                    icon={iconTriangleAlert}
                    className="automation__status-icon automation__status-icon--warning"
                  />
                )}
                {!jobActive && showJobError && (
                  <Icon
                    icon={iconCircleAlert}
                    className="automation__status-icon automation__status-icon--error"
                  />
                )}
                {!jobActive && showCancelled && (
                  <Icon
                    icon={iconBan}
                    className="automation__status-icon automation__status-icon--cancelled"
                  />
                )}
                <span className="automation__job-type">{jobTypeLabel(job)}</span>
                <span className="automation__status-label">{statusLabel(job)}</span>
              </span>
              <span className="automation__counts">
                {job.processed}/{job.total || "..."}
                {remainingTime && <span className="automation__remaining"> · {remainingTime}</span>}
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
                className={`automation__progress-bar${showJobError ? " automation__progress-bar--error" : ""}${showJobWarning ? " automation__progress-bar--warning" : ""}${showCancelled ? " automation__progress-bar--cancelled" : ""}`}
                style={{ width: `${progressPercent(job)}%` }}
              />
            </div>

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
