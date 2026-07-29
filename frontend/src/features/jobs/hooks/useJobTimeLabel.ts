import { useEffect, useRef, useState } from "react";
import type { Job } from "@/shared/types";
import {
  createJobTimingTracker,
  isActiveJobStatus,
  jobTimeLabel,
  updateJobTimingTracker,
  type JobTimingTracker,
} from "@/features/jobs/lib/jobs";

/** Remaining-time estimate while the job runs; how long it took once it finished. */
export function useJobTimeLabel(job: Job | null): string | null {
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

  return jobTimeLabel(job, nowMs, trackerRef.current);
}
