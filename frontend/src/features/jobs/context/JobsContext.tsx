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
import { subscribeToServerEvents } from "@/shared/api/eventStream";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { ExternalOstrisJob, Job, JobType } from "@/shared/types";
import { foldersMatch } from "@/features/browse/lib/folderPath";
import {
  isActiveJobStatus,
  isTerminalJobStatus,
  jobCompletionNotification,
  selectFolderJob,
  upsertJob,
} from "@/features/jobs/lib/jobs";
import {
  clearStartingJobIfMatch,
  upsertStartedJob,
  type StartingJob,
} from "@/features/jobs/lib/jobStartHelpers";

// Only used while the push stream is down — the server otherwise tells us when
// something changes, so there is nothing to ask for on a timer.
const ACTIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 8000;

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
  /** Starts any job type; ``body`` carries whatever that type's route expects. */
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
  const [streamConnected, setStreamConnected] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [startingJob, setStartingJob] = useState<StartingJob | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [stoppingOstrisJobId, setStoppingOstrisJobId] = useState<string | null>(null);
  const previousJobStatusesRef = useRef<Map<string, Job["status"]>>(new Map());

  const refreshJobs = useCallback(async () => {
    const response = await fetchJobs();
    setJobs(response.jobs);
    return response;
  }, []);

  const refreshExternalJobs = useCallback(async () => {
    try {
      const response = await fetchOstrisJobs();
      setExternalJobs(response.jobs);
      setOstrisAvailable(response.available);
      return response;
    } catch {
      setExternalJobs([]);
      setOstrisAvailable(false);
      return { jobs: [], active_count: 0, available: false };
    }
  }, []);

  const refreshAllJobs = useCallback(async () => {
    const [internalResponse, externalResponse] = await Promise.all([
      refreshJobs(),
      refreshExternalJobs(),
    ]);
    return {
      internal: internalResponse,
      external: externalResponse,
    };
  }, [refreshJobs, refreshExternalJobs]);

  // `/api/external/ostris/jobs` only ever lists runs that are still going, so its
  // length is the external active count.
  const activeCount = useMemo(
    () => jobs.filter((job) => isActiveJobStatus(job.status)).length + externalJobs.length,
    [jobs, externalJobs],
  );

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeToServerEvents({
      onEvent: (event) => {
        if (cancelled) return;

        if (event.type === "job") {
          setJobs((current) => upsertJob(current, event.job));
          return;
        }

        setExternalJobs(event.jobs);
        setOstrisAvailable(event.available);
      },
      onConnectedChange: (connected) => {
        if (cancelled) return;
        setStreamConnected(connected);
        // A fresh connection may have missed changes while it was down, and the
        // stream carries no history, so start again from the full state.
        if (connected) void refreshAllJobs();
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshAllJobs]);

  // The fallback path: without a stream nothing would arrive at all, so poll until
  // one is back. Also the initial load, since the stream only opens after mount.
  useEffect(() => {
    if (streamConnected) return;

    let cancelled = false;
    let timeoutId = 0;

    const poll = async () => {
      try {
        const response = await refreshAllJobs();
        if (cancelled) return;
        const hasActiveJobs =
          response.internal.active_count > 0 || response.external.active_count > 0;
        timeoutId = window.setTimeout(poll, hasActiveJobs ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      } catch {
        if (cancelled) return;
        timeoutId = window.setTimeout(poll, IDLE_POLL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [streamConnected, refreshAllJobs]);

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
        if (notification) {
          notify(notification);
        }
      }

      previousJobStatusesRef.current.set(job.id, job.status);
    }
  }, [jobs, notify]);

  // Keep the transient "cancelling" indicator for a job until we observe (via poll or refresh)
  // that it has left the active (queued/running) state. This is especially noticeable for
  // long-per-item jobs like auto-caption, where the runner may still be finishing the current
  // file after the cancel flag was set.
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
        // Do not clear cancellingJobId here. The effect above will clear it once
        // a subsequent jobs update shows that this job is no longer active/running.
        // This keeps the "Cancelling..." spinner visible until the runner has actually
        // reacted to the cancel (important for auto-caption and other slow-per-item jobs).
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
