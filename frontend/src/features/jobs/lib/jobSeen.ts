import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import type { Job } from "@/shared/types";
import { isTerminalJobStatus, parseJobTimestamp } from "./jobs";

/** Local, not session: a job finished while every tab was closed must still read as new. */
export const JOBS_SEEN_AT_KEY = "jobs-seen-at";

function parseSeenAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The first run starts from now, so a history that predates the marker is not all new. */
export function readJobsSeenAt(nowMs = Date.now()): number {
  const stored = readStoredJson(JOBS_SEEN_AT_KEY, parseSeenAt, null);
  if (stored !== null) return stored;

  writeJobsSeenAt(nowMs);
  return nowMs;
}

export function writeJobsSeenAt(seenAtMs: number): void {
  writeStoredJson(JOBS_SEEN_AT_KEY, seenAtMs);
}

/** The value a `storage` event carries, or null when it is not a usable marker. */
export function parseJobsSeenAt(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    return parseSeenAt(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function jobFinishedMs(job: Job): number | null {
  return isTerminalJobStatus(job.status) ? parseJobTimestamp(job.finished_at) : null;
}

export function isUnseenJob(job: Job, seenAtMs: number): boolean {
  const finishedMs = jobFinishedMs(job);
  return finishedMs !== null && finishedMs > seenAtMs;
}

/**
 * Never before a shown job's finish, so a server clock ahead of this one cannot re-flag it.
 * With `isShown`, stops short of the earliest unseen job a drawer filter hid: one timestamp
 * cannot mark later jobs seen while keeping an earlier one new.
 */
export function nextJobsSeenAt(
  jobs: readonly Job[],
  nowMs = Date.now(),
  isShown?: (job: Job) => boolean,
  seenAtMs = Number.NEGATIVE_INFINITY,
): number {
  const next = jobs.reduce((latest, job) => Math.max(latest, jobFinishedMs(job) ?? 0), nowMs);
  if (!isShown) return next;

  const earliestHidden = jobs
    .filter((job) => !isShown(job) && isUnseenJob(job, seenAtMs))
    .reduce((earliest, job) => Math.min(earliest, jobFinishedMs(job) ?? earliest), Infinity);
  return Math.min(next, earliestHidden - 1);
}
