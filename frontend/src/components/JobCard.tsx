import {
  iconBan,
  iconCircleCheck,
  iconCircleAlert,
  iconLoader2,
  iconTrash2,
  iconTriangleAlert,
} from "../icons";
import type { Job } from "../types";
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
  statusLabel,
} from "../utils/jobs";
import { useJobRemainingTime } from "../hooks/useJobRemainingTime";
import { Icon } from "./Icon";

interface JobCardProps {
  job: Job;
  isCurrentFolder?: boolean;
  onOpenFolder?: (folderPath: string) => void;
  onCancel?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
  cancelling?: boolean;
}

export function JobCard({
  job,
  isCurrentFolder = false,
  onOpenFolder,
  onCancel,
  onDelete,
  cancelling = false,
}: JobCardProps) {
  const tone = jobStatusTone(job);
  const active = isActiveJobStatus(job.status);
  const showError = jobShowsErrorState(job);
  const showWarning = jobShowsWarningState(job);
  const showCancelled = jobIsCancelled(job);
  const errorMessage = jobErrorMessage(job);
  const warningMessage = jobWarningMessage(job);
  const folderLabel = job.folder_name || job.folder;
  const remainingTime = useJobRemainingTime(job);
  const jobTypeIcon = jobIcon(job);

  return (
    <article
      className={`job-card job-card--${tone}${showError ? " job-card--danger" : ""}${showWarning ? " job-card--warning" : ""}${isCurrentFolder ? " job-card--current" : ""}`}
      aria-label={`${jobTypeLabel(job)} job for ${folderLabel}`}
    >
      <div className="job-card__header">
        <button
          type="button"
          className="job-card__folder"
          onClick={() => onOpenFolder?.(job.folder)}
          title={`${jobTypeLabel(job)} · ${job.folder}`}
        >
          <Icon icon={jobTypeIcon} className="job-card__folder-icon" />
          <span className="job-card__folder-name">{folderLabel}</span>
        </button>

        <div className="job-card__header-actions">
          <span className={`job-card__badge job-card__badge--${tone}`}>
            {active && (
              <Icon
                icon={iconLoader2}
                className="job-card__badge-icon job-card__badge-icon--spin"
              />
            )}
            {!active && job.status === "completed" && !showError && !showWarning && (
              <Icon icon={iconCircleCheck} className="job-card__badge-icon" />
            )}
            {!active && showWarning && (
              <Icon icon={iconTriangleAlert} className="job-card__badge-icon" />
            )}
            {!active && showError && (
              <Icon icon={iconCircleAlert} className="job-card__badge-icon" />
            )}
            {!active && showCancelled && <Icon icon={iconBan} className="job-card__badge-icon" />}
            <span className="job-card__badge-label">{statusLabel(job)}</span>
          </span>

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

      <div className="job-card__meta">
        <span className="job-card__meta-count">
          {job.processed}/{job.total || "..."}
        </span>
        {remainingTime && <span className="job-card__remaining">{remainingTime}</span>}
      </div>

      <div
        className="job-card__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent(job)}
        aria-label={`Progress for ${folderLabel}`}
      >
        <div
          className={`job-card__progress-bar${showError ? " job-card__progress-bar--error" : ""}${showWarning ? " job-card__progress-bar--warning" : ""}${showCancelled ? " job-card__progress-bar--cancelled" : ""}`}
          style={{ width: `${progressPercent(job)}%` }}
        />
      </div>

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
    </article>
  );
}
