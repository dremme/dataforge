import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { fetchJobs } from "@/features/jobs/api/jobs";
import type { JobsQuery } from "@/features/jobs/lib/jobFilters";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import { formatApiError } from "@/shared/api/http";
import type { JobsResponse } from "@/shared/types";

export const JOB_HISTORY_PAGE_SIZE = 50;

interface UseJobHistoryOptions {
  enabled: boolean;
  /** Any change reloads from the first page, e.g. a job starting, finishing or being deleted. */
  refreshKey: string;
}

type HistoryPages = InfiniteData<JobsResponse, number>;

/** Stored job history for the drawer, one page at a time. Live progress comes from the context. */
export function useJobHistory(query: JobsQuery, { enabled, refreshKey }: UseJobHistoryOptions) {
  const queryClient = useQueryClient();
  const { jobTypes, status, folder } = query;
  const queryKey = useMemo(
    () => jobKeys.historyPage({ jobTypes, status, folder }),
    [jobTypes, status, folder],
  );

  const history = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      fetchJobs({
        limit: JOB_HISTORY_PAGE_SIZE,
        offset: pageParam,
        jobTypes,
        status,
        folder,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.jobs.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    enabled,
  });

  // Later pages are offsets into a list that just changed, so only the first one is re-read.
  const reload = useCallback(async () => {
    queryClient.setQueryData<HistoryPages>(
      queryKey,
      (data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
    );
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  const seenRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (seenRefreshKey.current === refreshKey) return;
    seenRefreshKey.current = refreshKey;
    void reload();
  }, [refreshKey, reload]);

  const { data, isFetching, error, hasNextPage, fetchNextPage } = history;
  const jobs = useMemo(() => data?.pages.flatMap((page) => page.jobs) ?? [], [data]);

  const loadMore = useCallback(() => {
    if (!isFetching) void fetchNextPage();
  }, [fetchNextPage, isFetching]);

  return {
    jobs,
    total: data?.pages.at(-1)?.total ?? 0,
    loading: enabled && isFetching,
    error: error ? formatApiError(error) : null,
    hasMore: hasNextPage,
    loadMore,
    reload,
  };
}
