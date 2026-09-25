import type { AppIcon } from "@/shared/icons";
import type { Job, JobStatus, JobType } from "@/shared/types";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { isKnownJobType, jobTypeIconFor, jobTypeLabelFor, PRIMARY_JOB_TYPE } from "./jobMeta";

export function jobTypeOf(job: Job): JobType {
  return isKnownJobType(job.job_type) ? job.job_type : PRIMARY_JOB_TYPE;
}

export function jobTypeLabel(job: Job): string {
  return jobTypeLabelFor(job.job_type);
}

export function jobIcon(job: Job): AppIcon {
  return jobTypeIconFor(job.job_type);
}

function compareJobRecency(a: Job, b: Job): number {
  const aCreated = Date.parse(a.created_at);
  const bCreated = Date.parse(b.created_at);
  const aTime = Number.isNaN(aCreated) ? 0 : aCreated;
  const bTime = Number.isNaN(bCreated) ? 0 : bCreated;
  return bTime - aTime;
}

export function selectFolderJob(
  jobs: Job[],
  folderPath: string | undefined,
  jobType?: JobType,
): Job | null {
  if (!folderPath) return null;

  const folderJobs = jobs.filter(
    (job) => foldersMatch(job.folder, folderPath) && (!jobType || jobTypeOf(job) === jobType),
  );
  if (folderJobs.length === 0) return null;

  const activeJobs = folderJobs.filter((job) => isActiveJobStatus(job.status));
  const candidates = activeJobs.length > 0 ? activeJobs : folderJobs;

  return candidates.reduce<Job | null>((latest, job) => {
    if (!latest || compareJobRecency(latest, job) > 0) {
      return job;
    }
    return latest;
  }, null);
}

/** Earlier runs for the same folder and type stay: the server keeps them as history too. */
export function upsertJob(jobs: Job[], job: Job): Job[] {
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index === -1) return [job, ...jobs];

  const merged = [...jobs];
  merged[index] = job;
  return merged;
}

export function isTrainLoraCoTrackedByExternal(
  job: Job,
  externalJobs: ReadonlyArray<{ name: string }>,
): boolean {
  if (jobTypeOf(job) !== "train_lora") return false;

  const ref = job.external_ref?.trim();
  if (!ref) return false;

  return externalJobs.some((external) => external.name === ref);
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

export function jobShowsErrorState(job: Job): boolean {
  return job.effective_status === "failed" || job.effective_status === "interrupted";
}

export function jobShowsWarningState(job: Job): boolean {
  return jobWarningMessage(job) !== null;
}

export function jobErrorMessage(job: Job): string | null {
  return job.error ?? null;
}

export function jobWarningMessage(job: Job): string | null {
  return job.warning ?? null;
}

export function progressPercent(job: Job): number {
  if (!job.total) return 0;
  return Math.min(100, Math.round((job.processed / job.total) * 100));
}

export function jobIsCancelled(job: Job): boolean {
  return job.effective_status === "cancelled";
}

export function statusLabel(job: Job): string {
  const status = job.effective_status;

  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return jobShowsWarningState(job) ? "Warnings" : "Completed";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    default:
      return job.status;
  }
}

export type JobStatusTone = "active" | "success" | "danger" | "warning" | "muted";

export function statusTone(status: JobStatus): JobStatusTone {
  if (isActiveJobStatus(status)) return "active";
  if (status === "completed") return "success";
  if (status === "failed" || status === "interrupted") return "danger";
  if (status === "cancelled") return "warning";
  return "muted";
}

export function jobStatusTone(job: Job): JobStatusTone {
  if (jobShowsWarningState(job)) {
    return "warning";
  }

  return statusTone(job.effective_status);
}

const FAST_ITEM_SECONDS = 0.25;
const FAST_BATCH_MAX_SECONDS_PER_ITEM = 1.5;
const SLOW_ITEM_MIN_SECONDS = 3;

export interface JobTimingTracker {
  jobId: string;
  lastProcessed: number;
  lastSampleMs: number;
  slowItems: number;
  recentFastStreak: number;
}

export function createJobTimingTracker(jobId: string): JobTimingTracker {
  return {
    jobId,
    lastProcessed: 0,
    lastSampleMs: 0,
    slowItems: 0,
    recentFastStreak: 0,
  };
}

export function classifyProcessedBatch(
  deltaProcessed: number,
  elapsedMs: number,
): { slow: number; fast: number } {
  if (deltaProcessed <= 0) {
    return { slow: 0, fast: 0 };
  }

  const elapsedSeconds = elapsedMs / 1000;
  const secondsPerItem = elapsedSeconds / deltaProcessed;

  if (secondsPerItem < FAST_BATCH_MAX_SECONDS_PER_ITEM) {
    return { slow: 0, fast: deltaProcessed };
  }

  if (deltaProcessed === 1 && elapsedSeconds >= SLOW_ITEM_MIN_SECONDS) {
    return { slow: 1, fast: 0 };
  }

  const baselineSeconds = deltaProcessed * FAST_BATCH_MAX_SECONDS_PER_ITEM;
  const excessSeconds = Math.max(0, elapsedSeconds - baselineSeconds);
  const slowItems = Math.min(
    deltaProcessed,
    Math.max(1, Math.round(excessSeconds / SLOW_ITEM_MIN_SECONDS)),
  );

  return { slow: slowItems, fast: deltaProcessed - slowItems };
}

export function updateJobTimingTracker(
  tracker: JobTimingTracker,
  job: Job,
  nowMs: number,
): JobTimingTracker {
  if (tracker.jobId !== job.id) {
    return createJobTimingTracker(job.id);
  }

  const processed = job.processed;
  if (tracker.lastSampleMs === 0) {
    return { ...tracker, lastSampleMs: nowMs, lastProcessed: processed };
  }

  if (processed <= tracker.lastProcessed) {
    return tracker;
  }

  const deltaProcessed = processed - tracker.lastProcessed;
  const elapsedMs = nowMs - tracker.lastSampleMs;
  const batch = classifyProcessedBatch(deltaProcessed, elapsedMs);

  return {
    ...tracker,
    lastProcessed: processed,
    lastSampleMs: nowMs,
    slowItems: tracker.slowItems + batch.slow,
    recentFastStreak: batch.slow > 0 ? 0 : tracker.recentFastStreak + batch.fast,
  };
}

/** Every file costs about the same, so elapsed time over processed files predicts the rest. */
const STEADY_RATE_JOB_TYPES: ReadonlySet<JobType> = new Set([
  "backup_captions",
  "restore_captions",
  "check_caption_rules",
  "set_captions",
  "batch_rename",
  "replace_captions",
  "find_duplicates",
]);

interface TimingSplit {
  /** Per-file statuses behind the expensive step: a model call, an ffmpeg run, a workflow. */
  slow: readonly string[];
  fast: readonly string[];
  /** Fast files still did real work, so their rate stands in until a slow one finishes. */
  fastIsWork?: boolean;
}

const MEDIA_KIND_SPLIT: TimingSplit = {
  slow: ["video_success", "ffmpeg_error"],
  fast: ["image_success", "read_error", "write_error"],
  fastIsWork: true,
};

const TIMING_SPLITS: Partial<Record<JobType, TimingSplit>> = {
  auto_caption: {
    slow: ["success", "api_error", "frame_error", "too_short", "read_error", "write_error"],
    fast: ["no_caption", "skipped_long"],
  },
  edit_captions: {
    slow: ["success", "api_error", "unchanged", "rejected", "read_error", "write_error"],
    fast: ["no_caption"],
  },
  verify_captions: {
    slow: ["success", "api_error", "parse_error", "frame_error", "read_error", "write_error"],
    fast: ["no_caption"],
  },
  comfy_process: {
    slow: ["success", "comfy_error", "write_error"],
    fast: ["skipped", "read_error"],
  },
  watermark: MEDIA_KIND_SPLIT,
  strip_metadata: MEDIA_KIND_SPLIT,
};

export function jobTimingCounts(job: Job): { fast: number; slow: number } {
  const split = TIMING_SPLITS[jobTypeOf(job)];
  const stats = job.stats ?? {};
  const total = (keys: readonly string[] = []) =>
    keys.reduce((sum, key) => sum + (stats[key] ?? 0), 0);

  return { slow: total(split?.slow), fast: total(split?.fast) };
}

function estimateSlowRemainingFraction(
  job: Job,
  counts: { fast: number; slow: number },
  tracker: JobTimingTracker | null | undefined,
): number {
  const processed = job.processed;
  if (processed <= 0) {
    return 0;
  }

  const trackedSlow = tracker?.slowItems ?? 0;
  const slowCompleted = Math.max(counts.slow, trackedSlow);
  const fastCompleted = counts.fast > 0 ? counts.fast : Math.max(0, processed - slowCompleted);

  if (tracker && tracker.recentFastStreak >= 3) {
    const globalSlowFraction = slowCompleted / processed;
    return Math.min(globalSlowFraction, 0.05);
  }

  if (slowCompleted > 0) {
    const globalSlowFraction = slowCompleted / processed;

    if (globalSlowFraction < 0.25 && fastCompleted > slowCompleted) {
      return 1;
    }

    return globalSlowFraction;
  }

  return 0.5;
}

/** Interrupted-job SQLite timestamps are "YYYY-MM-DD HH:MM:SS" with no zone; treat them as UTC. */
function parseJobTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;

  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const parsed = Date.parse(hasZone ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));

  if (seconds < 60) {
    return seconds <= 1 ? "1s" : `${seconds}s`;
  }

  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes < 60) {
    return totalMinutes === 1 ? "1 min" : `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return hours === 1 ? "1 hr" : `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function jobSecondsPerStep(job: Job): number | null {
  const speedMs = job.stats?.speed_ms_per_step;
  return typeof speedMs === "number" && speedMs > 0 ? speedMs / 1000 : null;
}

export function trainingRemainingTimeLabel(
  step: number,
  totalSteps: number | null | undefined,
  secondsPerStep: number | null | undefined,
): string {
  if (!totalSteps || totalSteps <= 0 || !secondsPerStep || secondsPerStep <= 0) {
    return "Estimating...";
  }

  const remainingSteps = totalSteps - step;
  if (remainingSteps <= 0) {
    return "<1 min left";
  }

  const remainingSeconds = remainingSteps * secondsPerStep;
  if (remainingSeconds <= 60) {
    return "<1 min left";
  }

  return `~${formatDuration(remainingSeconds)} left`;
}

export function jobRemainingSeconds(
  job: Job,
  nowMs = Date.now(),
  tracker?: JobTimingTracker | null,
): number | null {
  if (!isActiveJobStatus(job.status) || job.status === "queued") {
    return null;
  }

  if (!job.total || job.total <= 0 || job.processed <= 0) {
    return null;
  }

  const remainingItems = job.total - job.processed;
  if (remainingItems <= 0) {
    return 0;
  }

  const startedMs = parseJobTimestamp(job.started_at) ?? parseJobTimestamp(job.created_at);
  if (startedMs === null) {
    return null;
  }

  const elapsedSeconds = Math.max(1, (nowMs - startedMs) / 1000);
  const steadyRateSeconds = Math.ceil(remainingItems * (elapsedSeconds / job.processed));
  if (STEADY_RATE_JOB_TYPES.has(jobTypeOf(job))) {
    return steadyRateSeconds;
  }

  const counts = jobTimingCounts(job);
  const trackedSlow = tracker?.slowItems ?? 0;
  const slowCompleted = Math.max(counts.slow, trackedSlow);

  if (slowCompleted < 1) {
    const noCounts = counts.fast + counts.slow === 0 && trackedSlow < 1;
    return noCounts || TIMING_SPLITS[jobTypeOf(job)]?.fastIsWork ? steadyRateSeconds : null;
  }

  const fastCompleted = counts.fast > 0 ? counts.fast : Math.max(0, job.processed - slowCompleted);
  const adjustedElapsed = Math.max(
    slowCompleted,
    elapsedSeconds - fastCompleted * FAST_ITEM_SECONDS,
  );
  const slowRate = adjustedElapsed / slowCompleted;
  const slowRemainingFraction = estimateSlowRemainingFraction(job, counts, tracker);
  const estimatedSlowRemaining = remainingItems * slowRemainingFraction;
  const estimatedFastRemaining = remainingItems - estimatedSlowRemaining;

  return Math.ceil(estimatedFastRemaining * FAST_ITEM_SECONDS + estimatedSlowRemaining * slowRate);
}

export function jobRemainingTimeLabel(
  job: Job,
  nowMs = Date.now(),
  tracker?: JobTimingTracker | null,
): string | null {
  if (!isActiveJobStatus(job.status)) {
    return null;
  }

  if (job.status === "queued") {
    return null;
  }

  // Training remaining time uses Ostris sec/iter; wall-clock includes queue/load before step 1.
  if (jobTypeOf(job) === "train_lora") {
    return trainingRemainingTimeLabel(job.processed, job.total, jobSecondsPerStep(job));
  }

  const remainingSeconds = jobRemainingSeconds(job, nowMs, tracker);
  if (remainingSeconds === null) {
    return "Estimating...";
  }

  if (remainingSeconds <= 1) {
    return "<1 min left";
  }

  return `~${formatDuration(remainingSeconds)} left`;
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.round(Math.max(0, totalSeconds));

  if (seconds < 1) {
    return "<1s";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    return restSeconds === 0 ? `${minutes} min` : `${minutes} min ${restSeconds}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function jobElapsedSeconds(job: Job): number | null {
  if (!isTerminalJobStatus(job.status)) {
    return null;
  }

  const finishedMs = parseJobTimestamp(job.finished_at);
  if (finishedMs === null) {
    return null;
  }

  const startedMs = parseJobTimestamp(job.started_at) ?? parseJobTimestamp(job.created_at);
  if (startedMs === null) {
    return null;
  }

  return Math.max(0, (finishedMs - startedMs) / 1000);
}

export function jobElapsedTimeLabel(job: Job): string | null {
  const elapsedSeconds = jobElapsedSeconds(job);
  if (elapsedSeconds === null) {
    return null;
  }

  return `Took ${formatElapsed(elapsedSeconds)}`;
}

export function jobTimeLabel(
  job: Job,
  nowMs = Date.now(),
  tracker?: JobTimingTracker | null,
): string | null {
  if (isActiveJobStatus(job.status)) {
    return jobRemainingTimeLabel(job, nowMs, tracker);
  }

  return jobElapsedTimeLabel(job);
}
