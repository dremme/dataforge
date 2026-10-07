import { useState } from "react";
import type { AutomationActions } from "@/features/automation/lib/automationActions";
import {
  JOB_TYPE_META,
  PRIMARY_JOB_TYPE,
  SECONDARY_JOB_GROUPS,
  jobMenuLabelFor,
  jobStartBlock,
  jobTypeIconFor,
  jobTypeLabelFor,
} from "@/features/jobs/lib/jobMeta";
import {
  isActiveJobStatus,
  jobErrorMessage,
  jobIsCancelled,
  jobShowsErrorState,
  jobShowsWarningState,
  jobWarningMessage,
  progressPercent,
} from "@/features/jobs/lib/jobs";
import { JobStatusBadge } from "@/features/jobs/components/JobStatusBadge";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { useJobTimeLabel } from "@/features/jobs/hooks/useJobTimeLabel";
import { failedCountFromStats } from "@/features/jobs/lib/jobFileResults";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";
import {
  iconHammer,
  iconMessageCheck,
  iconCpu,
  iconFileCheck,
  iconFilePen,
  iconFilePlus,
  iconScanSquare,
  iconChevronDown,
  iconBan,
  iconList,
  iconLoader2,
  iconCircleAlert,
  iconTriangleAlert,
  iconX,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { AutomationSystemSpecs } from "@/features/automation/components/AutomationSystemSpecs";
import { useAutomationSpecsVisible } from "@/features/automation/hooks/useAutomationSpecsVisible";

interface ToolsMenuProps {
  panel: AutomationActions;
}

// No scope line: each job's confirmation dialog states which files it targets. Auto-caption has
// its own button, so the menu lists only the secondary jobs.
function ToolsMenuItems({ panel, onPick }: ToolsMenuProps & { onPick: () => void }) {
  return (
    <div className="workspace-tools__groups">
      {SECONDARY_JOB_GROUPS.map((group) => (
        <div
          key={group.id}
          role="group"
          aria-label={group.label}
          className="workspace-tools__group"
        >
          <div className="workspace-tools__group-label" aria-hidden="true">
            {group.label}
          </div>
          {group.types.map((type) => {
            const { blocked, reason } = jobStartBlock(type, panel.startContext);
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="workspace-tools__item"
                disabled={blocked}
                onClick={() => {
                  onPick();
                  panel.onRequestStart(type);
                }}
              >
                <Icon icon={jobTypeIconFor(type)} className="workspace-tools__item-icon" />
                <span className="workspace-tools__item-text">
                  <span className="workspace-tools__item-title">{jobMenuLabelFor(type)}</span>
                  <span className="workspace-tools__item-desc">
                    {JOB_TYPE_META[type].menuDescription}
                  </span>
                  {reason && <span className="workspace-tools__item-desc">{reason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ToolsMenu(props: ToolsMenuProps) {
  const menu = usePopupMenu();
  return (
    <>
      <div ref={menu.rootRef}>
        <button type="button" className="workspace-button" {...menu.triggerProps}>
          <Icon icon={iconHammer} />
          Tools
          <Icon icon={iconChevronDown} />
        </button>
      </div>
      <AnchoredLayer
        anchorRef={menu.rootRef}
        floatingRef={menu.panelRef}
        open={menu.open}
        id={menu.menuId}
        placement="bottom-start"
        className="workspace-tools"
        role="menu"
        label="Tools"
      >
        <ToolsMenuItems {...props} onPick={menu.close} />
      </AnchoredLayer>
    </>
  );
}

function ReviewMenu({ panel }: { panel: AutomationActions }) {
  const menu = usePopupMenu();
  const queues = [
    {
      label: "Caption issues",
      icon: iconMessageCheck,
      tone: "warning",
      count: panel.issueCount ?? 0,
      action: panel.onResolveIssues,
    },
    {
      label: "Duplicate groups",
      icon: iconFileCheck,
      tone: "warning",
      count: panel.duplicateGroupCount ?? 0,
      action: panel.onResolveDuplicates,
    },
    {
      label: "Pending candidates",
      icon: iconScanSquare,
      tone: "accent",
      count: panel.candidateCount ?? 0,
      action: panel.onReviewCandidates,
    },
  ];
  const total = queues.reduce((sum, queue) => sum + queue.count, 0);
  // Nothing to review: the button would only ever open a list of disabled rows.
  if (total === 0) return null;
  return (
    <>
      <div ref={menu.rootRef}>
        <button type="button" className="workspace-button" {...menu.triggerProps}>
          <Icon icon={iconMessageCheck} />
          Review <span className="workspace-actions__count">{total}</span>
          <Icon icon={iconChevronDown} />
        </button>
      </div>
      <AnchoredLayer
        anchorRef={menu.rootRef}
        floatingRef={menu.panelRef}
        open={menu.open}
        id={menu.menuId}
        placement="bottom-start"
        className="workspace-review"
        role="menu"
        label="Review queues"
      >
        {queues.map((queue) => (
          <button
            key={queue.label}
            type="button"
            role="menuitem"
            className={`workspace-review__item workspace-review__item--${queue.tone}`}
            disabled={!queue.action || queue.count === 0}
            onClick={() => {
              menu.close();
              queue.action?.();
            }}
          >
            <Icon icon={queue.icon} className="workspace-review__icon" />
            <span className="workspace-review__label">{queue.label}</span>
            <span className="workspace-review__count">{queue.count}</span>
          </button>
        ))}
      </AnchoredLayer>
    </>
  );
}

/** Folder actions that sit in the toolbar row. */
export function WorkspaceActions({ panel }: ToolsMenuProps) {
  const { showSpecs, toggleSpecs } = useAutomationSpecsVisible();
  const job = panel.job;
  const active = Boolean(job && isActiveJobStatus(job.status));
  const hasInstructions = panel.hasSyspromptFile || panel.hasCaptionRulesFile;
  const startingPrimary = panel.startingJobType === PRIMARY_JOB_TYPE;
  const autoCaption = jobStartBlock(PRIMARY_JOB_TYPE, panel.startContext);
  const autoCaptionTooltip = startingPrimary
    ? "Starting auto-caption job..."
    : panel.startingJobType !== null
      ? "Another job is starting..."
      : (autoCaption.reason ?? "Generate captions for files in scope");

  return (
    <div className="workspace-actions">
      <Tooltip
        content={
          hasInstructions
            ? "Edit the system prompt and caption rules for this folder"
            : "Create a system prompt or caption rules for this folder"
        }
      >
        <button type="button" className="workspace-button" onClick={panel.onEditSysprompt}>
          <Icon icon={hasInstructions ? iconFilePen : iconFilePlus} />
          {hasInstructions ? "Edit instructions" : "Create instructions"}
        </button>
      </Tooltip>
      {active ? (
        <button
          type="button"
          className="workspace-button"
          onClick={panel.onCancelJob}
          disabled={panel.cancellingJob}
        >
          <Icon icon={panel.cancellingJob ? iconLoader2 : iconBan} spin={panel.cancellingJob} />
          Cancel job
        </button>
      ) : (
        panel.startContext.canStart && (
          <>
            <Tooltip content={autoCaptionTooltip}>
              <button
                type="button"
                className="workspace-button workspace-button--accent"
                aria-busy={startingPrimary || undefined}
                disabled={autoCaption.blocked}
                onClick={() => panel.onRequestStart(PRIMARY_JOB_TYPE)}
              >
                <Icon
                  icon={startingPrimary ? iconLoader2 : jobTypeIconFor(PRIMARY_JOB_TYPE)}
                  spin={startingPrimary}
                />
                {jobMenuLabelFor(PRIMARY_JOB_TYPE)}
              </button>
            </Tooltip>
            <ToolsMenu panel={panel} />
          </>
        )
      )}
      <ReviewMenu panel={panel} />
      <Tooltip content={showSpecs ? "Hide system specifications" : "Show system specifications"}>
        <button
          type="button"
          className="workspace-button workspace-button--icon"
          onClick={toggleSpecs}
          aria-label="Toggle system specifications"
          aria-expanded={showSpecs}
          aria-controls={showSpecs ? "workspace-system-specs" : undefined}
        >
          <Icon icon={iconCpu} />
        </button>
      </Tooltip>
    </div>
  );
}

function jobTone(job: AutomationActions["job"]) {
  if (!job) return null;
  if (jobShowsErrorState(job)) return "error";
  if (jobIsCancelled(job)) return "cancelled";
  if (jobShowsWarningState(job)) return "warning";
  return null;
}

/**
 * The current job's progress and outcome beneath the toolbar. A job that finished cleanly needs
 * no attention, so only running, failed, cancelled, or warning jobs show here.
 */
export function WorkspaceActivity({ panel }: { panel: AutomationActions }) {
  const { toggleDrawer } = useJobs();
  const { showSpecs } = useAutomationSpecsVisible();
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const job = panel.job;
  const timeLabel = useJobTimeLabel(job);
  const active = Boolean(job && isActiveJobStatus(job.status));
  const tone = jobTone(job);
  const failedCount = job && !active ? failedCountFromStats(job.stats) : 0;
  const needsAttention = tone !== null || failedCount > 0;
  const visible = job && (active || (needsAttention && dismissedJobId !== job.id));
  const failedNote =
    failedCount > 0
      ? `${failedCount} ${failedCount === 1 ? "file" : "files"} failed. Job details lists them and can retry.`
      : null;
  const message = job ? (jobErrorMessage(job) ?? jobWarningMessage(job) ?? failedNote) : null;

  return (
    <>
      {visible && job && (
        <div className="workspace-activity" role="status">
          <div className="workspace-activity__row">
            <span className="workspace-activity__job">
              <Icon icon={jobTypeIconFor(job.job_type)} />
              <strong>{jobTypeLabelFor(job.job_type)}</strong>
            </span>
            <JobStatusBadge job={job} />
            {job.total > 0 && (
              <span className="workspace-activity__count">
                {job.processed} of {job.total} {job.job_type === "train_lora" ? "steps" : "files"}
              </span>
            )}
            {timeLabel && <span className="workspace-activity__count">{timeLabel}</span>}
            {active && job.current_name && (
              <span className="workspace-activity__current" title={job.current_name}>
                {job.current_name}
              </span>
            )}
            {active && (
              <div
                className="workspace-activity__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent(job)}
                aria-label="Job progress"
              >
                <div
                  className={classNames(
                    "workspace-activity__progress-bar",
                    tone && `workspace-activity__progress-bar--${tone}`,
                  )}
                  style={{ width: `${progressPercent(job)}%` }}
                />
              </div>
            )}
            {active && <span className="workspace-activity__percent">{progressPercent(job)}%</span>}
            <button type="button" className="workspace-button" onClick={toggleDrawer}>
              <Icon icon={iconList} />
              Job details
            </button>
            {!active && (
              <button
                type="button"
                className="workspace-button workspace-button--icon"
                onClick={() => setDismissedJobId(job.id)}
                aria-label="Dismiss job status"
              >
                <Icon icon={iconX} />
              </button>
            )}
          </div>
          {message && (
            <p
              className={classNames(
                "workspace-activity__message",
                jobErrorMessage(job) && "workspace-activity__message--error",
              )}
              role={jobErrorMessage(job) ? "alert" : undefined}
            >
              <Icon icon={jobErrorMessage(job) ? iconCircleAlert : iconTriangleAlert} />
              {message}
            </p>
          )}
        </div>
      )}
      {showSpecs && (
        <div className="workspace-system">
          <AutomationSystemSpecs id="workspace-system-specs" open jobActive={active} />
        </div>
      )}
    </>
  );
}
