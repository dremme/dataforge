import type { Job } from "@/shared/types";
import {
  iconBan,
  iconCircleAlert,
  iconCircleCheck,
  iconLoader2,
  iconTriangleAlert,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import {
  isActiveJobStatus,
  jobIsCancelled,
  jobShowsErrorState,
  jobShowsWarningState,
  jobStatusTone,
  statusLabel,
} from "@/features/jobs/lib/jobs";

export function JobStatusBadge({ job }: { job: Job }) {
  const active = isActiveJobStatus(job.status);
  const icon = active
    ? iconLoader2
    : jobShowsErrorState(job)
      ? iconCircleAlert
      : jobShowsWarningState(job)
        ? iconTriangleAlert
        : jobIsCancelled(job)
          ? iconBan
          : iconCircleCheck;
  return (
    <span className={`job-card__badge job-card__badge--${jobStatusTone(job)}`}>
      <Icon
        icon={icon}
        className={classNames("job-card__badge-icon", active && "job-card__badge-icon--spin")}
      />
      <span className="job-card__badge-label">{statusLabel(job)}</span>
    </span>
  );
}
