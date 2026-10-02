import { useQuery } from "@tanstack/react-query";
import { fetchJobResults } from "@/features/jobs/api/jobs";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import { isTerminalJobStatus } from "@/features/jobs/lib/jobs";
import { sortResultsForDisplay } from "@/features/jobs/lib/jobFileResults";
import type { Job, JobFileResult } from "@/shared/types";

export interface JobFileResultsState {
  results: JobFileResult[];
  loading: boolean;
  failed: boolean;
}

const NO_RESULTS: JobFileResult[] = [];

/** A finished job's per-file results. Fetched on demand: a large run is megabytes. */
export function useJobFileResults(job: Job, enabled: boolean): JobFileResultsState {
  const ready = enabled && isTerminalJobStatus(job.status);

  // Keyed by the finish time too: a retried job finishes again with different results.
  const { data, isFetching, isError } = useQuery({
    queryKey: jobKeys.results(job.id, job.finished_at),
    queryFn: async ({ signal }) => sortResultsForDisplay(await fetchJobResults(job.id, signal)),
    enabled: ready,
    retry: false,
  });

  return {
    results: (ready && data) || NO_RESULTS,
    loading: ready && isFetching,
    failed: ready && isError,
  };
}
