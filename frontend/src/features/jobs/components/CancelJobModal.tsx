import { jobTypeLabel } from "@/features/jobs/lib/jobs";
import { ConfirmModal } from "@/shared/ui/ConfirmModal";
import type { Job } from "@/shared/types";

interface CancelJobModalProps {
  job: Job;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asked before any job is cancelled, from the toolbar or a job card. */
export function CancelJobModal({ job, onConfirm, onCancel }: CancelJobModalProps) {
  const label = jobTypeLabel(job);
  const folder = job.folder_name || job.folder;

  return (
    <ConfirmModal
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
