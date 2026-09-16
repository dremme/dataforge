import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJobs } from "@/features/jobs/api/jobs";
import type { JobsQuery } from "@/features/jobs/lib/jobFilters";
import { formatApiError } from "@/shared/api/http";
import type { Job } from "@/shared/types";

export const JOB_HISTORY_PAGE_SIZE = 50;

interface JobHistoryState {
  jobs: Job[];
  total: number;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: JobHistoryState = { jobs: [], total: 0, loading: false, error: null };

interface UseJobHistoryOptions {
  enabled: boolean;
  /** Any change reloads from the first page, e.g. a job starting, finishing or being deleted. */
  refreshKey: string;
}

/** Stored job history for the drawer, one page at a time. Live progress comes from the context. */
export function useJobHistory(query: JobsQuery, { enabled, refreshKey }: UseJobHistoryOptions) {
  const [state, setState] = useState<JobHistoryState>(EMPTY_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const { jobType, status, folder } = query;

  const load = useCallback(
    async (offset: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState((current) => ({ ...current, loading: true, error: null }));

      try {
        const response = await fetchJobs({
          limit: JOB_HISTORY_PAGE_SIZE,
          offset,
          jobType,
          status,
          folder,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setState((current) => ({
          jobs: offset === 0 ? response.jobs : [...current.jobs, ...response.jobs],
          total: response.total,
          loading: false,
          error: null,
        }));
      } catch (caught) {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: formatApiError(caught) }));
      }
    },
    [jobType, status, folder],
  );

  useEffect(() => {
    if (!enabled) return;

    void load(0);
    return () => controllerRef.current?.abort();
  }, [enabled, load, refreshKey]);

  const loadMore = useCallback(() => {
    if (!state.loading) void load(state.jobs.length);
  }, [load, state.jobs.length, state.loading]);

  return { ...state, hasMore: state.jobs.length < state.total, loadMore };
}
