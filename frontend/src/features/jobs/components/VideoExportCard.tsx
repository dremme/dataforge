import { iconBan, iconClapperboard, iconLoader2 } from "@/shared/icons";
import type { VideoProjectExportState } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface VideoExportCardProps {
  item: VideoProjectExportState;
  isCurrentFolder?: boolean;
  onOpenFolder?: (folderPath: string) => void;
  onCancel: (exportId: string) => void;
}

/** A video export while it renders; its outcome is announced by a notification. */
export function VideoExportCard({
  item,
  isCurrentFolder = false,
  onOpenFolder,
  onCancel,
}: VideoExportCardProps) {
  const progress = Math.round(item.progress * 100);

  return (
    <article
      className={classNames(
        "job-card job-card--external job-card--active",
        isCurrentFolder && "job-card--current",
      )}
      aria-label={`video export ${item.output_name}`}
    >
      <div className="job-card__header">
        {onOpenFolder ? (
          <button
            type="button"
            className="job-card__folder"
            onClick={() => onOpenFolder(item.folder)}
            title={`${item.output_name} · ${item.folder}`}
          >
            <Icon icon={iconClapperboard} className="job-card__folder-icon" />
            <span className="job-card__folder-name">{item.output_name}</span>
          </button>
        ) : (
          <div className="job-card__folder job-card__folder--static" title={item.output_name}>
            <Icon icon={iconClapperboard} className="job-card__folder-icon" />
            <span className="job-card__folder-name">{item.output_name}</span>
          </div>
        )}

        <div className="job-card__header-actions">
          <span className="job-card__badge job-card__badge--active">
            <Icon icon={iconLoader2} className="job-card__badge-icon job-card__badge-icon--spin" />
            <span className="job-card__badge-label">Exporting</span>
          </span>

          <button
            type="button"
            className="job-card__cancel"
            onClick={() => onCancel(item.id)}
            aria-label={`Cancel export ${item.output_name}`}
            title="Cancel export"
          >
            <Icon icon={iconBan} />
          </button>
        </div>
      </div>

      <div className="job-card__source">{item.project_name}</div>

      <div className="job-card__meta">
        <span className="job-card__meta-count">{progress}%</span>
      </div>

      <div
        className="job-card__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={`Progress for ${item.output_name}`}
      >
        <div className="job-card__progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}
