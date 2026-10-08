import {
  iconBan,
  iconCircleAlert,
  iconFolder,
  iconLoader2,
  iconTrash2,
  iconTriangleAlert,
  type AppIcon,
} from "@/shared/icons";
import type { Job } from "@/shared/types";
import {
  isActiveJobStatus,
  jobErrorMessage,
  jobIcon,
  jobIsCancelled,
  jobShowsErrorState,
  jobShowsWarningState,
  jobStatusTone,
  jobTypeLabel,
  jobWarningMessage,
  progressPercent,
} from "@/features/jobs/lib/jobs";
import {
  jobHeadline,
  jobOutcomeMix,
  jobThroughputLabel,
  jobUnitWord,
  jobWhenLabel,
  type JobOutcomeMix,
} from "@/features/jobs/lib/jobInsights";
import { useJobTimeLabel } from "@/features/jobs/hooks/useJobTimeLabel";
import { useTrainingSamples } from "@/features/jobs/hooks/useTrainingSamples";
import { classNames } from "@/shared/lib/classNames";
import { formatCount } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";
import { TrainingSamples } from "./TrainingSamples";
import { JobStatusBadge } from "./JobStatusBadge";
import { JobFileResults } from "./JobFileResults";
import { ComfyProcessLog } from "@/features/automation/components/ComfyProcessLog";

/** Something to do about a finished job, such as reviewing the issues it found. */
export interface JobFollowUp {
  label: string;
  icon: AppIcon;
  onClick: () => void;
}

interface JobCardProps {
  onOpenItem?: (path: string) => void;
  onRetryFailed?: (paths: string[]) => void;
  followUps?: readonly JobFollowUp[];
  job: Job;
  /** Finished since the drawer was last closed. */
  isNew?: boolean;
  /** Shared by every card so relative times agree; defaults to render time. */
  nowMs?: number;
  isCurrentFolder?: boolean;
  onOpenFolder?: (folderPath: string) => void;
  onCancel?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
  cancelling?: boolean;
  onLightboxOpenChange?: (open: boolean) => void;
}

const MIX_PARTS: ReadonlyArray<{ key: keyof JobOutcomeMix; word: string }> = [
  { key: "done", word: "done" },
  { key: "skipped", word: "skipped" },
  { key: "failed", word: "failed" },
  { key: "notRun", word: "not run" },
];

function JobOutcome({ mix }: { mix: JobOutcomeMix }) {
  const parts = MIX_PARTS.filter(({ key }) => mix[key] > 0);
  const summary = parts.map(({ key, word }) => `${formatCount(mix[key])} ${word}`).join(", ");

  return (
    <figure className="job-card__outcome" aria-label={`Outcome: ${summary}`}>
      <div className="job-card__outcome-track" aria-hidden="true">
        {parts.map(({ key }) => (
          <span
            key={key}
            className={`job-card__outcome-segment job-card__outcome-segment--${key}`}
            style={{ flexGrow: mix[key] }}
          />
        ))}
      </div>
      <figcaption className="job-card__outcome-legend" aria-hidden="true">
        {parts.map(({ key, word }) => (
          <span key={key} className={`job-card__outcome-item job-card__outcome-item--${key}`}>
            <strong>{formatCount(mix[key])}</strong> {word}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function JobCard({
  job,
  isNew = false,
  nowMs,
  isCurrentFolder = false,
  onOpenFolder,
  onCancel,
  onDelete,
  cancelling = false,
  onLightboxOpenChange,
  onOpenItem,
  onRetryFailed,
  followUps = [],
}: JobCardProps) {
  const tone = jobStatusTone(job);
  const active = isActiveJobStatus(job.status);
  const showError = jobShowsErrorState(job);
  const showWarning = jobShowsWarningState(job);
  const showCancelled = jobIsCancelled(job);
  const errorMessage = jobErrorMessage(job);
  const warningMessage = jobWarningMessage(job);
  const folderLabel = job.folder_name || job.folder;
  const label = jobTypeLabel(job);
  const timeLabel = useJobTimeLabel(job);
  const samples = useTrainingSamples(job);
  const when = jobWhenLabel(job, nowMs);
  const mix = active ? null : jobOutcomeMix(job);
  const throughput = jobThroughputLabel(job);
  const headline = jobHeadline(job);
  const percent = progressPercent(job);
  const countLabel =
    job.total > 0
      ? `${formatCount(job.processed)} of ${formatCount(job.total)} ${jobUnitWord(job, job.total)}`
      : null;
  const hasFollowUps = !active && followUps.length > 0;

  return (
    <article
      className={classNames(
        "job-card",
        `job-card--${tone}`,
        isCurrentFolder && "job-card--current",
        isNew && "job-card--new",
      )}
      aria-label={`${label} job for ${folderLabel}`}
    >
      <div className="job-card__header">
        <span className="job-card__type-icon" aria-hidden="true">
          <Icon icon={jobIcon(job)} />
        </span>

        <div className="job-card__heading">
          <div className="job-card__title-row">
            <h4 className="job-card__title">{label}</h4>
            {isNew && <span className="job-card__new">New</span>}
          </div>
          <div className="job-card__subtitle">
            <button
              type="button"
              className="job-card__folder"
              onClick={() => onOpenFolder?.(job.folder)}
              title={isCurrentFolder ? `${job.folder} (open now)` : `Open ${job.folder}`}
            >
              <Icon icon={iconFolder} className="job-card__folder-icon" />
              <span className="job-card__folder-name">{folderLabel}</span>
            </button>
            {when && (
              <span className="job-card__when" title={when.title ?? undefined}>
                {when.label}
              </span>
            )}
          </div>
        </div>

        <div className="job-card__header-actions">
          <JobStatusBadge job={job} />

          {active && onCancel && (
            <button
              type="button"
              className="job-card__cancel"
              onClick={() => onCancel(job.id)}
              disabled={cancelling}
              aria-label={`Cancel job for ${folderLabel}`}
              title={cancelling ? "Cancelling job..." : "Cancel job"}
            >
              <Icon
                icon={cancelling ? iconLoader2 : iconBan}
                className={cancelling ? "job-card__cancel-icon--spin" : undefined}
              />
            </button>
          )}

          {!active && onDelete && (
            <button
              type="button"
              className="job-card__delete"
              onClick={() => onDelete(job.id)}
              aria-label={`Delete job for ${folderLabel}`}
              title="Delete job"
            >
              <Icon icon={iconTrash2} />
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="job-card__live">
          <div className="job-card__live-row">
            <span className="job-card__count">
              {job.status === "queued" ? "Waiting to start" : (countLabel ?? "Preparing...")}
            </span>
            {timeLabel && <span className="job-card__remaining">{timeLabel}</span>}
            {job.total > 0 && <span className="job-card__percent">{percent}%</span>}
          </div>
          <div
            className="job-card__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`Progress for ${folderLabel}`}
          >
            <div
              className={classNames(
                "job-card__progress-bar",
                showError && "job-card__progress-bar--error",
                showWarning && "job-card__progress-bar--warning",
                showCancelled && "job-card__progress-bar--cancelled",
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          {job.current_name && (
            <p className="job-card__current" title={job.current_name}>
              {job.current_name}
            </p>
          )}
        </div>
      )}

      {!active && mix && <JobOutcome mix={mix} />}

      {!active && (
        <ul className="job-card__facts">
          {!mix && countLabel && <li className="job-card__count">{countLabel}</li>}
          {headline && <li className="job-card__headline">{headline}</li>}
          {timeLabel && <li className="job-card__remaining">{timeLabel}</li>}
          {throughput && <li>{throughput}</li>}
        </ul>
      )}

      {warningMessage && (
        <div className="job-card__warning" role="status">
          <Icon icon={iconTriangleAlert} className="job-card__warning-icon" />
          <span>{warningMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="job-card__error" role="alert">
          <Icon icon={iconCircleAlert} className="job-card__error-icon" />
          <span>{errorMessage}</span>
        </div>
      )}

      {hasFollowUps && (
        <div className="job-card__follow-ups">
          {followUps.map((followUp) => (
            <button
              key={followUp.label}
              type="button"
              className="job-card__follow-up"
              onClick={followUp.onClick}
            >
              <Icon icon={followUp.icon} className="job-card__follow-up-icon" />
              {followUp.label}
            </button>
          ))}
        </div>
      )}

      <TrainingSamples samples={samples} compact onLightboxOpenChange={onLightboxOpenChange} />
      <ComfyProcessLog job={job} />
      <JobFileResults job={job} onOpenItem={onOpenItem} onRetryFailed={onRetryFailed} />
    </article>
  );
}
