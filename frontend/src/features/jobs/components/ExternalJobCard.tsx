import { iconBan, iconBrain, iconHourglass, iconLoader2 } from "@/shared/icons";
import type { ExternalOstrisJob } from "@/shared/types";
import {
  externalJobModelLabel,
  externalJobProgressPercent,
  externalJobRemainingTimeLabel,
  externalJobStatusLabel,
} from "@/features/jobs/lib/externalJobs";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface ExternalJobCardProps {
  job: ExternalOstrisJob;
  isCurrentFolder?: boolean;
  onOpenFolder?: (folderPath: string) => void;
  onStop?: (jobId: string) => void;
  stopping?: boolean;
}

export function ExternalJobCard({
  job,
  isCurrentFolder = false,
  onOpenFolder,
  onStop,
  stopping = false,
}: ExternalJobCardProps) {
  const progress = externalJobProgressPercent(job);
  const remainingTime = externalJobRemainingTimeLabel(job);
  const datasetFolder = job.dataset_folder;
  const canOpenDataset = Boolean(datasetFolder && onOpenFolder);
  // A queued run can sit in AI-Toolkit's queue for a long time with nothing happening yet.
  const waiting = job.status === "queued" && !stopping;

  return (
    <article
      className={classNames(
        "job-card job-card--external job-card--active",
        isCurrentFolder && "job-card--current",
      )}
      aria-label={`external job ${job.name}`}
    >
      <div className="job-card__header">
        {canOpenDataset ? (
          <button
            type="button"
            className="job-card__folder"
            onClick={() => onOpenFolder?.(datasetFolder!)}
            title={`${job.name} · ${datasetFolder}`}
          >
            <Icon icon={iconBrain} className="job-card__folder-icon" />
            <span className="job-card__folder-name">{job.name}</span>
          </button>
        ) : (
          <div className="job-card__folder job-card__folder--static" title={job.name}>
            <Icon icon={iconBrain} className="job-card__folder-icon" />
            <span className="job-card__folder-name">{job.name}</span>
          </div>
        )}

        <div className="job-card__header-actions">
          <span className="job-card__badge job-card__badge--active">
            <Icon
              icon={waiting ? iconHourglass : iconLoader2}
              className={classNames(
                "job-card__badge-icon",
                !waiting && "job-card__badge-icon--spin",
              )}
            />
            <span className="job-card__badge-label">{externalJobStatusLabel(job, stopping)}</span>
          </span>

          {onStop && (
            <button
              type="button"
              className="job-card__cancel"
              onClick={() => onStop(job.id)}
              disabled={stopping}
              aria-label={`Stop job ${job.name}`}
              title={
                stopping
                  ? job.save_now
                    ? "Saving checkpoint..."
                    : "Stopping job..."
                  : "Stop job and save checkpoint"
              }
            >
              <Icon
                icon={stopping ? iconLoader2 : iconBan}
                className={stopping ? "job-card__cancel-icon--spin" : undefined}
              />
            </button>
          )}
        </div>
      </div>

      <div className="job-card__source">
        <span>{externalJobModelLabel(job)}</span>
        <span className="job-card__source-separator" aria-hidden="true">
          ·
        </span>
        <span>{job.info}</span>
      </div>

      <div className="job-card__meta">
        <span className="job-card__meta-count">
          {job.step}/{job.total_steps ?? "..."}
        </span>
        {remainingTime && <span className="job-card__remaining">{remainingTime}</span>}
      </div>

      <div
        className="job-card__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={`Progress for ${job.name}`}
      >
        <div className="job-card__progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}
