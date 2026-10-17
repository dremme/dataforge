import { useEffect, useState } from "react";
import type { Job } from "@/shared/types";
import {
  createJobTimingTracker,
  isActiveJobStatus,
  jobTimeLabel,
  updateJobTimingTracker,
  type JobTimingTracker,
} from "@/features/jobs/lib/jobs";

interface Timing {
  nowMs: number;
  tracker: JobTimingTracker | null;
}

/** Remaining-time estimate while the job runs; how long it took once it finished. */
export function useJobTimeLabel(job: Job | null): string | null {
  const [timing, setTiming] = useState<Timing>(() => ({ nowMs: Date.now(), tracker: null }));

  useEffect(() => {
    if (!job || !isActiveJobStatus(job.status)) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect -- forgets the finished job's samples
      setTiming((current) => (current.tracker ? { ...current, tracker: null } : current));
      return;
    }

    // Each job update is a progress sample, timed when it arrives.
    const sampledMs = Date.now();
    // Unchanged state must stay the same object, or a fresh job object per render never settles.
    setTiming((current) => {
      const base =
        current.tracker?.jobId === job.id ? current.tracker : createJobTimingTracker(job.id);
      const tracker = updateJobTimingTracker(base, job, sampledMs);
      return tracker === current.tracker && sampledMs === current.nowMs
        ? current
        : { nowMs: sampledMs, tracker };
    });
    const intervalId = window.setInterval(() => {
      const nowMs = Date.now();
      setTiming((current) => (current.nowMs === nowMs ? current : { ...current, nowMs }));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [job]);

  if (!job) {
    return null;
  }

  return jobTimeLabel(job, timing.nowMs, timing.tracker);
}
