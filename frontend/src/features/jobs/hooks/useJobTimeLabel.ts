import { useEffect, useRef, useState } from "react";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import {
  coTrackedExternalTrainingJob,
  createJobTimingTracker,
  isActiveJobStatus,
  jobTimeLabel,
  updateJobTimingTracker,
  type JobTimingTracker,
} from "@/features/jobs/lib/jobs";
import { externalJobRemainingTimeLabel } from "@/features/jobs/lib/externalJobs";

/** Remaining-time estimate while the job runs; how long it took once it finished. */
export function useJobTimeLabel(
  job: Job | null,
  externalJobs: ReadonlyArray<ExternalOstrisJob> = [],
): string | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const trackerRef = useRef<JobTimingTracker | null>(null);

  useEffect(() => {
    if (!job || !isActiveJobStatus(job.status)) {
      trackerRef.current = null;
      return;
    }

    if (!trackerRef.current || trackerRef.current.jobId !== job.id) {
      trackerRef.current = createJobTimingTracker(job.id);
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [job]);

  useEffect(() => {
    if (!job || !isActiveJobStatus(job.status) || !trackerRef.current) {
      return;
    }

    trackerRef.current = updateJobTimingTracker(trackerRef.current, job, Date.now());
  }, [job]);

  if (!job) {
    return null;
  }

  // While Ostris still lists the run, use its estimate so the automation panel
  // matches the external job card exactly.
  if (isActiveJobStatus(job.status)) {
    const external = coTrackedExternalTrainingJob(job, externalJobs);
    if (external) {
      return externalJobRemainingTimeLabel(external);
    }
  }

  return jobTimeLabel(job, nowMs, trackerRef.current);
}
