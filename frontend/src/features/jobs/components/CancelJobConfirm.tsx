import { jobTypeLabel } from "@/features/jobs/lib/jobs";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { Job } from "@/shared/types";

interface CancelJobConfirmProps {
  job: Job;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asked before any job is cancelled, from the toolbar or a job card. */
export function CancelJobConfirm({ job, onConfirm, onCancel }: CancelJobConfirmProps) {
  const label = jobTypeLabel(job);
  const folder = job.folder_name || job.folder;

  return (
    <ConfirmDialog
      title={`Cancel ${label.toLowerCase()} job?`}
      description={`The job in "${folder}" stops after the file it is working on. Files it already processed keep their results.`}
      confirmLabel="Cancel job"
      cancelLabel="Keep running"
      confirmVariant="warning"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
