import { useEffect, useState } from "react";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import { isTerminalJobStatus } from "@/features/jobs/lib/jobs";
import { sortResultsForDisplay } from "@/features/jobs/lib/jobFileResults";
import type { Job, JobFileResult } from "@/shared/types";

export interface JobFileResultsState {
  results: JobFileResult[];
  loading: boolean;
  failed: boolean;
}

/** A finished job's per-file results. Fetched on demand: a large run is megabytes. */
export function useJobFileResults(job: Job, enabled: boolean): JobFileResultsState {
  const [results, setResults] = useState<JobFileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const jobId = job.id;
  const finishedAt = job.finished_at;
  const ready = enabled && isTerminalJobStatus(job.status);

  useEffect(() => {
    if (!ready) {
      setResults([]);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetchJobResults(jobId)
      .then((fetched) => {
        if (cancelled) return;
        setResults(sortResultsForDisplay(fetched));
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [finishedAt, jobId, ready]);

  return { results, loading, failed };
}
