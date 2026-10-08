import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { startAutomationJob, type JobStartBody } from "@/features/automation/api/jobs";
import {
  cancelJob,
  deleteAllJobs,
  deleteJob,
  fetchJobs,
  fetchLatestFolderJob,
} from "@/features/jobs/api/jobs";
import { fetchOstrisJobs, stopOstrisJob } from "@/features/jobs/api/externalJobs";
import { useServerEvent, useStreamConnected } from "@/shared/events/serverEvents";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import { mergedRead } from "@/shared/query/queryClient";
import type { ExternalOstrisJob, ExternalOstrisJobsResponse, Job, JobType } from "@/shared/types";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import {
  isActiveJobStatus,
  isTerminalJobStatus,
  jobShowsErrorState,
  runningJobCount,
  selectFolderJob,
} from "@/features/jobs/lib/jobs";
import {
  isUnseenJob,
  JOBS_SEEN_AT_KEY,
  nextJobsSeenAt,
  parseJobsSeenAt,
  readJobsSeenAt,
  writeJobsSeenAt,
} from "@/features/jobs/lib/jobSeen";
import { jobKeys } from "@/features/jobs/lib/jobQueries";
import {
  EMPTY_LIVE_JOBS,
  PENDING_REMOVAL_REVISION,
  externalJobsFromEvent,
  mergeJobsListing,
  newerExternalJobs,
  removeJobs,
  upsertByRevision,
  type LiveJobs,
} from "@/features/jobs/lib/jobsCache";
import type { StartingJob } from "@/features/jobs/lib/jobStartHelpers";

// Fast poll only when the push stream is down.
export const DISCONNECTED_ACTIVE_POLL_MS = 1000;
export const DISCONNECTED_IDLE_POLL_MS = 8000;
// Slow reconciliation while connected: a full stream queue can still drop frames.
export const CONNECTED_ACTIVE_POLL_MS = 15000;
export const CONNECTED_IDLE_POLL_MS = 60000;
// Hidden tabs drop the stream on purpose; do not treat that as disconnected (fast poll).
export const HIDDEN_POLL_MS = 60000;

function jobsPollDelay(streamConnected: boolean, hasActiveJobs: boolean): number {
  if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
  if (streamConnected) return hasActiveJobs ? CONNECTED_ACTIVE_POLL_MS : CONNECTED_IDLE_POLL_MS;
  return hasActiveJobs ? DISCONNECTED_ACTIVE_POLL_MS : DISCONNECTED_IDLE_POLL_MS;
}

const NO_EXTERNAL_JOBS: ExternalOstrisJobsResponse = {
  jobs: [],
  active_count: 0,
  available: false,
  revision: 0,
};

const readLiveJobs = mergedRead((signal) => fetchJobs({ signal }), mergeJobsListing);

const readExternalJobs = mergedRead(
  // A missing AI-Toolkit is an expected state, not an error to retry.
  (signal) => fetchOstrisJobs(signal).catch(() => NO_EXTERNAL_JOBS),
  newerExternalJobs,
);

interface JobsContextValue {
  jobs: Job[];
  externalJobs: ExternalOstrisJob[];
  ostrisAvailable: boolean;
  activeCount: number;
  /** Jobs that finished after the drawer was last closed; the drawer marks them "New". */
  seenAtMs: number;
  unseenCount: number;
  /** Any unseen job failed or was interrupted. */
  unseenFailed: boolean;
  drawerOpen: boolean;
  startingJob: StartingJob | null;
  cancellingJobId: string | null;
  stoppingOstrisJobId: string | null;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** The drawer's filter, or null when it shows every job; closing marks only shown jobs seen. */
  setShownJobFilter: (isShown: ((job: Job) => boolean) | null) => void;
  startJob: (
    jobType: JobType,
    folderPath: string,
    body?: JobStartBody,
    paths?: string[],
  ) => Promise<Job | null>;
  cancelJob: (jobId: string) => Promise<Job | null>;
  stopExternalOstrisJob: (jobId: string) => Promise<boolean>;
  deleteJob: (jobId: string) => Promise<boolean>;
  deleteAllJobs: () => Promise<boolean>;
}

const JobsContext = createContext<JobsContextValue | null>(null);

interface StartJobVariables {
  jobType: JobType;
  folderPath: string;
  body?: JobStartBody;
  paths?: string[];
}

/** The mutation's result, or `fallback` once its `onError` has told the user. */
async function settle<T>(run: Promise<T>, fallback: T): Promise<T> {
  try {
    return await run;
  } catch {
    return fallback;
  }
}

function useJobPushes(queryClient: QueryClient) {
  useServerEvent((event) => {
    if (event.type === "job") {
      queryClient.setQueryData<LiveJobs>(jobKeys.live, (live) => upsertByRevision(live, event.job));
      return;
    }

    if (event.type === "jobs_removed") {
      queryClient.setQueryData<LiveJobs>(jobKeys.live, (live) =>
        removeJobs(live, event.ids, event.revision),
      );
      return;
    }

    if (event.type === "external_jobs") {
      queryClient.setQueryData<ExternalOstrisJobsResponse>(jobKeys.external, (cached) =>
        newerExternalJobs(cached, externalJobsFromEvent(event)),
      );
    }
  });
}

/** Drops jobs from the live list before the server confirms; the snapshot undoes it. */
async function removeOptimistically(queryClient: QueryClient, ids: readonly string[]) {
  await queryClient.cancelQueries({ queryKey: jobKeys.live });
  const previous = queryClient.getQueryData<LiveJobs>(jobKeys.live);
  queryClient.setQueryData<LiveJobs>(jobKeys.live, (live) =>
    removeJobs(live, ids, PENDING_REMOVAL_REVISION),
  );
  return { previous };
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const streamConnected = useStreamConnected();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenAtMs, setSeenAtMs] = useState(() => readJobsSeenAt());

  const liveQuery = useQuery({
    queryKey: jobKeys.live,
    queryFn: readLiveJobs,
    refetchInterval: (query) =>
      jobsPollDelay(
        streamConnected,
        (query.state.data?.jobs ?? []).some((job) => isActiveJobStatus(job.status)),
      ),
    refetchIntervalInBackground: true,
    meta: { pushFed: true },
  });

  const externalQuery = useQuery({
    queryKey: jobKeys.external,
    queryFn: readExternalJobs,
    refetchInterval: (query) =>
      jobsPollDelay(streamConnected, (query.state.data?.active_count ?? 0) > 0),
    refetchIntervalInBackground: true,
    meta: { pushFed: true },
  });

  useJobPushes(queryClient);

  const jobs = (liveQuery.data ?? EMPTY_LIVE_JOBS).jobs;
  const external = externalQuery.data ?? NO_EXTERNAL_JOBS;
  const { refetch: refetchLive } = liveQuery;
  const { refetch: refetchExternal } = externalQuery;

  useEffect(() => {
    if (!drawerOpen) return;
    void refetchLive();
    void refetchExternal();
  }, [drawerOpen, refetchLive, refetchExternal]);

  // Another tab closing its drawer has seen the same jobs.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== JOBS_SEEN_AT_KEY) return;
      const next = parseJobsSeenAt(event.newValue);
      if (next !== null) setSeenAtMs(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const shownJobFilterRef = useRef<((job: Job) => boolean) | null>(null);
  const setShownJobFilter = useCallback((isShown: ((job: Job) => boolean) | null) => {
    shownJobFilterRef.current = isShown;
  }, []);

  // Seen on close, not open: marking on open would erase the markers the user came to read.
  useEffect(() => {
    if (!drawerOpen) return;
    return () => {
      const isShown = shownJobFilterRef.current ?? undefined;
      const next = nextJobsSeenAt(jobsRef.current, Date.now(), isShown, readJobsSeenAt());
      writeJobsSeenAt(next);
      setSeenAtMs(next);
    };
  }, [drawerOpen]);

  const { unseenCount, unseenFailed } = useMemo(() => {
    const unseen = jobs.filter((job) => isUnseenJob(job, seenAtMs));
    return { unseenCount: unseen.length, unseenFailed: unseen.some(jobShowsErrorState) };
  }, [jobs, seenAtMs]);

  const activeCount = useMemo(() => runningJobCount(jobs, external.jobs), [jobs, external.jobs]);

  const refreshLive = useCallback(
    () => queryClient.invalidateQueries({ queryKey: jobKeys.live }),
    [queryClient],
  );

  const reportError = useCallback(
    (prefix: string, error: unknown) =>
      notify({ variant: "danger", message: `${prefix}${formatApiError(error)}` }),
    [notify],
  );

  const start = useMutation({
    mutationFn: ({ jobType, folderPath, body, paths }: StartJobVariables) =>
      startAutomationJob(jobType, folderPath, body, paths),
    onSuccess: async (created) => {
      queryClient.setQueryData<LiveJobs>(jobKeys.live, (live) => upsertByRevision(live, created));
      await refreshLive();
    },
    onError: (error) => reportError("", error),
  });

  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: refreshLive,
    onError: (error) => reportError("", error),
  });

  const stop = useMutation({
    mutationFn: stopOstrisJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.external }),
    onError: (error) => reportError("", error),
  });

  const remove = useMutation({
    mutationFn: deleteJob,
    onMutate: (jobId) => removeOptimistically(queryClient, [jobId]),
    onError: (error, _jobId, context) => {
      queryClient.setQueryData(jobKeys.live, context?.previous);
      reportError("Could not delete job: ", error);
    },
    onSettled: refreshLive,
  });

  const removeAll = useMutation({
    mutationFn: deleteAllJobs,
    onMutate: () => {
      const live = queryClient.getQueryData<LiveJobs>(jobKeys.live);
      return removeOptimistically(
        queryClient,
        (live?.jobs ?? []).map((job) => job.id),
      );
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(jobKeys.live, context?.previous);
      reportError("Could not delete jobs: ", error);
    },
    onSettled: refreshLive,
  });

  const startingFolder = start.isPending ? start.variables?.folderPath : undefined;
  const startingType = start.isPending ? start.variables?.jobType : undefined;
  const startingJob = useMemo<StartingJob | null>(
    () =>
      startingFolder && startingType ? { folder: startingFolder, jobType: startingType } : null,
    [startingFolder, startingType],
  );

  // "Cancelling" lasts until the job leaves queued/running; slow jobs finish the file first.
  const cancelTarget = cancel.isIdle || cancel.isError ? null : (cancel.variables ?? null);
  const cancellingJobId =
    cancelTarget &&
    (cancel.isPending ||
      jobs.some((job) => job.id === cancelTarget && isActiveJobStatus(job.status)))
      ? cancelTarget
      : null;

  const stoppingOstrisJobId = stop.isPending ? (stop.variables ?? null) : null;

  const { mutateAsync: startAsync } = start;
  const { mutateAsync: cancelAsync } = cancel;
  const { mutateAsync: stopAsync } = stop;
  const { mutateAsync: removeAsync } = remove;
  const { mutateAsync: removeAllAsync } = removeAll;

  const startJob = useCallback(
    (jobType: JobType, folderPath: string, body?: JobStartBody, paths?: string[]) =>
      settle(startAsync({ jobType, folderPath, body, paths }), null),
    [startAsync],
  );
  const cancelJobImpl = useCallback(
    (jobId: string) => settle(cancelAsync(jobId), null),
    [cancelAsync],
  );
  const stopExternalOstrisJob = useCallback(
    (jobId: string) =>
      settle(
        stopAsync(jobId).then(() => true),
        false,
      ),
    [stopAsync],
  );
  const deleteJobImpl = useCallback(
    (jobId: string) =>
      settle(
        removeAsync(jobId).then(() => true),
        false,
      ),
    [removeAsync],
  );
  const deleteAllJobsImpl = useCallback(
    () =>
      settle(
        removeAllAsync().then(() => true),
        false,
      ),
    [removeAllAsync],
  );

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((current) => !current), []);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs,
      externalJobs: external.jobs,
      ostrisAvailable: external.available,
      activeCount,
      seenAtMs,
      unseenCount,
      unseenFailed,
      drawerOpen,
      startingJob,
      cancellingJobId,
      stoppingOstrisJobId,
      closeDrawer,
      toggleDrawer,
      setShownJobFilter,
      startJob,
      cancelJob: cancelJobImpl,
      stopExternalOstrisJob,
      deleteJob: deleteJobImpl,
      deleteAllJobs: deleteAllJobsImpl,
    }),
    [
      jobs,
      external,
      activeCount,
      seenAtMs,
      unseenCount,
      unseenFailed,
      drawerOpen,
      startingJob,
      cancellingJobId,
      stoppingOstrisJobId,
      closeDrawer,
      toggleDrawer,
      setShownJobFilter,
      startJob,
      cancelJobImpl,
      stopExternalOstrisJob,
      deleteJobImpl,
      deleteAllJobsImpl,
    ],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const context = useContext(JobsContext);
  if (!context) {
    throw new Error("useJobs must be used within JobsProvider");
  }
  return context;
}

export function useFolderJob(folderPath: string | undefined) {
  const { jobs } = useJobs();

  const contextJob = useMemo(() => selectFolderJob(jobs, folderPath), [jobs, folderPath]);

  // The live list holds recent jobs only; an older folder's last run is asked for directly.
  const latestQuery = useQuery({
    queryKey: jobKeys.folderLatest(folderPath ?? ""),
    queryFn: ({ signal }) => fetchLatestFolderJob(folderPath!, signal),
    enabled: Boolean(folderPath) && !contextJob,
  });

  const resolvedJob = contextJob ?? (folderPath ? (latestQuery.data ?? null) : null);

  const folderHasActiveJob = useMemo(
    () => jobs.some((job) => foldersMatch(job.folder, folderPath) && isActiveJobStatus(job.status)),
    [jobs, folderPath],
  );

  return {
    job: resolvedJob,
    folderHasActiveJob,
  };
}

export function useJobTransitions(onTerminalForFolder: (folderPath: string) => void) {
  const { jobs } = useJobs();
  const previousStatusesRef = useRef<Map<string, Job["status"]>>(new Map());

  useEffect(() => {
    for (const job of jobs) {
      const previousStatus = previousStatusesRef.current.get(job.id);
      const becameTerminal =
        previousStatus && !isTerminalJobStatus(previousStatus) && isTerminalJobStatus(job.status);

      if (becameTerminal) {
        onTerminalForFolder(job.folder);
      }

      previousStatusesRef.current.set(job.id, job.status);
    }
  }, [jobs, onTerminalForFolder]);
}
