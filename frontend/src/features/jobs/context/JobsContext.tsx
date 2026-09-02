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
import type { ExternalOstrisJob, Job, JobType, JobsResponse } from "@/shared/types";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import {
  isActiveJobStatus,
  isTerminalJobStatus,
  jobCompletionNotification,
  selectFolderJob,
  upsertJob,
} from "@/features/jobs/lib/jobs";
import { claimJobCompletionNotification } from "@/features/jobs/lib/jobCompletionNotifyClaim";
import {
  clearStartingJobIfMatch,
  upsertStartedJob,
  type StartingJob,
} from "@/features/jobs/lib/jobStartHelpers";

// Fast poll only when the push stream is down.
export const DISCONNECTED_ACTIVE_POLL_MS = 1000;
export const DISCONNECTED_IDLE_POLL_MS = 8000;
// Slow reconciliation while connected: push misses deleted jobs and dropped terminal frames.
export const CONNECTED_ACTIVE_POLL_MS = 15000;
export const CONNECTED_IDLE_POLL_MS = 60000;
// Hidden tabs drop the stream on purpose; do not treat that as disconnected (fast poll).
export const HIDDEN_POLL_MS = 60000;

function jobsPollDelay(streamConnected: boolean, hasActiveJobs: boolean): number {
  if (document.visibilityState !== "visible") return HIDDEN_POLL_MS;
  if (streamConnected) return hasActiveJobs ? CONNECTED_ACTIVE_POLL_MS : CONNECTED_IDLE_POLL_MS;
  return hasActiveJobs ? DISCONNECTED_ACTIVE_POLL_MS : DISCONNECTED_IDLE_POLL_MS;
}

type ExternalJobsSnapshot = {
  jobs: ExternalOstrisJob[];
  active_count: number;
  available: boolean;
};

type JobsRefreshResult = {
  internal: JobsResponse;
  external: ExternalJobsSnapshot;
};

interface JobsContextValue {
  jobs: Job[];
  externalJobs: ExternalOstrisJob[];
  ostrisAvailable: boolean;
  activeCount: number;
  drawerOpen: boolean;
  startingJob: StartingJob | null;
  cancellingJobId: string | null;
  stoppingOstrisJobId: string | null;
  closeDrawer: () => void;
  toggleDrawer: () => void;
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

export function JobsProvider({ children }: { children: ReactNode }) {
  const notify = useNotify();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [externalJobs, setExternalJobs] = useState<ExternalOstrisJob[]>([]);
  const [ostrisAvailable, setOstrisAvailable] = useState(false);
  const streamConnected = useStreamConnected();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [startingJob, setStartingJob] = useState<StartingJob | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [stoppingOstrisJobId, setStoppingOstrisJobId] = useState<string | null>(null);
  const previousJobStatusesRef = useRef<Map<string, Job["status"]>>(new Map());
  const refreshGenerationRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<JobsRefreshResult> | null>(null);
  const refreshQueuedRef = useRef(false);
  // Pushes that race an in-flight refresh must be reapplied; the response is older than the push.
  const pushedDuringRefreshRef = useRef<Map<string, Job>>(new Map());
  const refreshAllJobsRef = useRef<() => Promise<JobsRefreshResult>>(async () => ({
    internal: { jobs: [], active_count: 0 },
    external: { jobs: [], active_count: 0, available: false },
  }));

  const refreshAllJobs = useCallback(async (): Promise<JobsRefreshResult> => {
    refreshQueuedRef.current = true;

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const run = async (): Promise<JobsRefreshResult> => {
      let last: JobsRefreshResult = {
        internal: { jobs: [], active_count: 0 },
        external: { jobs: [], active_count: 0, available: false },
      };

      try {
        while (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          const generation = ++refreshGenerationRef.current;
          pushedDuringRefreshRef.current.clear();

          const [internal, external] = await Promise.all([
            fetchJobs(),
            fetchOstrisJobs().catch((): ExternalJobsSnapshot => ({
              jobs: [],
              active_count: 0,
              available: false,
            })),
          ]);

          last = { internal, external };

          if (generation === refreshGenerationRef.current) {
            const pushed = [...pushedDuringRefreshRef.current.values()];
            setJobs(pushed.reduce((merged, job) => upsertJob(merged, job), internal.jobs));
            setExternalJobs(external.jobs);
            setOstrisAvailable(external.available);
          }
        }

        return last;
      } finally {
        refreshInFlightRef.current = null;
        if (refreshQueuedRef.current) {
          void refreshAllJobsRef.current();
        }
      }
    };

    const promise = run();
    refreshInFlightRef.current = promise;
    return promise;
  }, []);

  refreshAllJobsRef.current = refreshAllJobs;

  const activeCount = useMemo(
    () => jobs.filter((job) => isActiveJobStatus(job.status)).length + externalJobs.length,
    [jobs, externalJobs],
  );

  useServerEvent((event) => {
    if (event.type === "job") {
      pushedDuringRefreshRef.current.set(event.job.id, event.job);
      setJobs((current) => upsertJob(current, event.job));
      return;
    }

    // Unrecognised frames stay inert; as external-jobs they set jobs to undefined and throw.
    if (event.type === "external_jobs") {
      setExternalJobs(event.jobs);
      setOstrisAvailable(event.available);
    }
  });

  useEffect(() => {
    if (streamConnected) void refreshAllJobs();
  }, [streamConnected, refreshAllJobs]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    const poll = async () => {
      try {
        const response = await refreshAllJobs();
        if (cancelled) return;
        const hasActiveJobs =
          response.internal.active_count > 0 || response.external.active_count > 0;
        timeoutId = window.setTimeout(poll, jobsPollDelay(streamConnected, hasActiveJobs));
      } catch {
        if (cancelled) return;
        timeoutId = window.setTimeout(poll, jobsPollDelay(streamConnected, false));
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [streamConnected, refreshAllJobs]);

  useEffect(() => {
    if (!drawerOpen) return;
    void refreshAllJobs();
  }, [drawerOpen, refreshAllJobs]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAllJobs();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshAllJobs]);

  useEffect(() => {
    const currentJobIds = new Set(jobs.map((job) => job.id));

    for (const jobId of previousJobStatusesRef.current.keys()) {
      if (!currentJobIds.has(jobId)) {
        previousJobStatusesRef.current.delete(jobId);
      }
    }

    for (const job of jobs) {
      const previousStatus = previousJobStatusesRef.current.get(job.id);
      const becameTerminal =
        previousStatus && !isTerminalJobStatus(previousStatus) && isTerminalJobStatus(job.status);

      if (becameTerminal) {
        const notification = jobCompletionNotification(job);
        if (notification && claimJobCompletionNotification(job.id, job.status)) {
          notify(notification);
        }
      }

      previousJobStatusesRef.current.set(job.id, job.status);
    }
  }, [jobs, notify]);

  // Keep "cancelling" until the job leaves queued/running; slow jobs finish the file first.
  useEffect(() => {
    if (cancellingJobId) {
      const cjob = jobs.find((j) => j.id === cancellingJobId);
      if (cjob && !isActiveJobStatus(cjob.status)) {
        setCancellingJobId(null);
      }
    }
  }, [jobs, cancellingJobId]);

  useEffect(() => {
    if (stoppingOstrisJobId) {
      const externalJob = externalJobs.find((job) => job.id === stoppingOstrisJobId);
      if (!externalJob) {
        setStoppingOstrisJobId(null);
      }
    }
  }, [externalJobs, stoppingOstrisJobId]);

  const runJobStart = useCallback(
    async (
      folderPath: string,
      jobType: JobType,
      startFn: () => Promise<Job>,
    ): Promise<Job | null> => {
      setStartingJob({ folder: folderPath, jobType });

      try {
        const createdJob = await startFn();
        setJobs((current) => upsertStartedJob(current, createdJob, folderPath, jobType));
        await refreshAllJobs();
        return createdJob;
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
        return null;
      } finally {
        setStartingJob((current) => clearStartingJobIfMatch(current, folderPath, jobType));
      }
    },
    [notify, refreshAllJobs],
  );

  const startJob = useCallback(
    (jobType: JobType, folderPath: string, body?: JobStartBody, paths?: string[]) =>
      runJobStart(folderPath, jobType, () => startAutomationJob(jobType, folderPath, body, paths)),
    [runJobStart],
  );

  const cancelJobImpl = useCallback(
    async (jobId: string) => {
      setCancellingJobId(jobId);

      try {
        const job = await cancelJob(jobId);
        await refreshAllJobs();
        return job;
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
        setCancellingJobId(null);
        return null;
      }
    },
    [notify, refreshAllJobs],
  );

  const stopExternalOstrisJobImpl = useCallback(
    async (jobId: string) => {
      setStoppingOstrisJobId(jobId);

      try {
        await stopOstrisJob(jobId);
        await refreshAllJobs();
        setStoppingOstrisJobId(null);
        return true;
      } catch (error) {
        notify({ variant: "danger", message: formatApiError(error) });
        setStoppingOstrisJobId(null);
        return false;
      }
    },
    [notify, refreshAllJobs],
  );

  const deleteJobImpl = useCallback(
    async (jobId: string) => {
      try {
        await deleteJob(jobId);
        await refreshAllJobs();
        return true;
      } catch {
        return false;
      }
    },
    [refreshAllJobs],
  );

  const deleteAllJobsImpl = useCallback(async () => {
    try {
      await deleteAllJobs();
      await refreshAllJobs();
      return true;
    } catch {
      return false;
    }
  }, [refreshAllJobs]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((current) => !current), []);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs,
      externalJobs,
      ostrisAvailable,
      activeCount,
      drawerOpen,
      startingJob,
      cancellingJobId,
      stoppingOstrisJobId,
      closeDrawer,
      toggleDrawer,
      startJob,
      cancelJob: cancelJobImpl,
      stopExternalOstrisJob: stopExternalOstrisJobImpl,
      deleteJob: deleteJobImpl,
      deleteAllJobs: deleteAllJobsImpl,
    }),
    [
      jobs,
      externalJobs,
      ostrisAvailable,
      activeCount,
      drawerOpen,
      startingJob,
      cancellingJobId,
      stoppingOstrisJobId,
      closeDrawer,
      toggleDrawer,
      startJob,
      cancelJobImpl,
      stopExternalOstrisJobImpl,
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
  const [hydratedJob, setHydratedJob] = useState<Job | null>(null);

  const contextJob = useMemo(() => selectFolderJob(jobs, folderPath), [jobs, folderPath]);

  useEffect(() => {
    if (!folderPath) {
      setHydratedJob(null);
      return;
    }

    if (contextJob) {
      setHydratedJob(contextJob);
      return;
    }

    let cancelled = false;

    fetchLatestFolderJob(folderPath)
      .then((latestJob) => {
        if (cancelled) return;
        setHydratedJob(latestJob);
      })
      .catch(() => {
        if (!cancelled) setHydratedJob(null);
      });

    return () => {
      cancelled = true;
    };
  }, [folderPath, contextJob]);

  const resolvedJob = contextJob ?? hydratedJob;

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
