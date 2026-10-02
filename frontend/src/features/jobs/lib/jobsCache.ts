import { upsertJob } from "@/features/jobs/lib/jobs";
import type {
  ExternalJobsEvent,
  ExternalOstrisJobsResponse,
  Job,
  JobsResponse,
} from "@/shared/types";

/**
 * The live job list as cached. Pushes and listings both land here and are ordered by the
 * server's revisions, so neither can roll the other back whichever arrives first.
 */
export interface LiveJobs {
  jobs: Job[];
  /** The newest listing merged in; a listing at or below it has nothing to add. */
  revision: number;
  /** Deleted job id → revision of the deletion, until a listing newer than that arrives. */
  removed: Record<string, number>;
}

export const EMPTY_LIVE_JOBS: LiveJobs = { jobs: [], revision: 0, removed: {} };

/** Outranks any server revision: an optimistic delete holds until a listing confirms it. */
export const PENDING_REMOVAL_REVISION = Number.MAX_SAFE_INTEGER;

export function upsertByRevision(live: LiveJobs | undefined, job: Job): LiveJobs {
  const base = live ?? EMPTY_LIVE_JOBS;
  if ((base.removed[job.id] ?? -1) >= job.revision) return base;

  const current = base.jobs.find((entry) => entry.id === job.id);
  if (current && current.revision >= job.revision) return base;

  return { ...base, jobs: upsertJob(base.jobs, job) };
}

export function removeJobs(
  live: LiveJobs | undefined,
  ids: readonly string[],
  revision: number,
): LiveJobs {
  const base = live ?? EMPTY_LIVE_JOBS;
  const gone = new Set(ids);
  const removed = { ...base.removed };
  for (const id of ids) removed[id] = Math.max(removed[id] ?? 0, revision);

  return { ...base, jobs: base.jobs.filter((job) => !gone.has(job.id)), removed };
}

/**
 * Folds a listing into the cache. A cached job beats its listed copy when its revision is
 * higher; a cached job the listing lacks survives only if it is newer than the listing (it
 * was created after the read), otherwise it was deleted.
 */
export function mergeJobsListing(live: LiveJobs | undefined, listing: JobsResponse): LiveJobs {
  if (live && listing.revision <= live.revision) return live;

  const cached = new Map((live?.jobs ?? []).map((job) => [job.id, job]));
  const removedAfter = (id: string) => (live?.removed[id] ?? -1) > listing.revision;

  const listed = listing.jobs
    .filter((job) => !removedAfter(job.id))
    .map((job) => {
      const held = cached.get(job.id);
      return held && held.revision > job.revision ? held : job;
    });

  const listedIds = new Set(listed.map((job) => job.id));
  const newer = (live?.jobs ?? []).filter(
    (job) => !listedIds.has(job.id) && job.revision > listing.revision,
  );

  // A deletion stays on record only while a listing still shows the job it hides.
  const stillListed = new Set(listing.jobs.map((job) => job.id));
  const removed = Object.fromEntries(
    Object.entries(live?.removed ?? {}).filter(
      ([id, revision]) => revision > listing.revision && stillListed.has(id),
    ),
  );

  return { jobs: [...newer, ...listed], revision: listing.revision, removed };
}

export function externalJobsFromEvent(event: ExternalJobsEvent): ExternalOstrisJobsResponse {
  const { jobs, active_count, available, revision } = event;
  return { jobs, active_count, available, revision };
}

/** Keeps the cached snapshot unless `fresh` is newer, so equal snapshots keep their identity. */
export function newerExternalJobs(
  cached: ExternalOstrisJobsResponse | undefined,
  fresh: ExternalOstrisJobsResponse,
): ExternalOstrisJobsResponse {
  return cached && cached.revision >= fresh.revision ? cached : fresh;
}
