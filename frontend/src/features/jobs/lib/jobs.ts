import type { AppIcon } from "@/shared/icons";
import type { Job, JobStatus, JobType } from "@/shared/types";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { folderLeafName, foldersMatch } from "@/features/folder/lib/folderPath";
import { isKnownJobType, jobTypeIconFor, jobTypeLabelFor, PRIMARY_JOB_TYPE } from "./jobMeta";

type JobCompletionNotificationVariant = "danger" | "warning" | "success";

export interface JobCompletionNotification {
  variant: JobCompletionNotificationVariant;
  message: string;
}

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

export function upsertJob(jobs: Job[], job: Job): Job[] {
  const index = jobs.findIndex((entry) => entry.id === job.id);
  if (index !== -1) {
    const merged = [...jobs];
    merged[index] = job;
    return merged;
  }

  const jobType = jobTypeOf(job);
  return [
    job,
    ...jobs.filter(
      (entry) => !(foldersMatch(entry.folder, job.folder) && jobTypeOf(entry) === jobType),
    ),
  ];
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

function jobApiErrorCount(job: Job): number {
  return job.stats?.api_error ?? 0;
}

function jobVerifyErrorCount(job: Job): number {
  const stats = job.stats ?? {};
  return (
    (stats.api_error ?? 0) +
    (stats.parse_error ?? 0) +
    (stats.read_error ?? 0) +
    (stats.frame_error ?? 0)
  );
}

function jobCaptionErrorCount(job: Job): number {
  const stats = job.stats ?? {};
  return (stats.api_error ?? 0) + (stats.read_error ?? 0) + (stats.frame_error ?? 0);
}

function jobNoCaptionCount(job: Job): number {
  return job.stats?.no_caption ?? 0;
}

function jobRejectedCount(job: Job): number {
  return job.stats?.rejected ?? 0;
}

function jobNoAudioCount(job: Job): number {
  return job.stats?.audio_error ?? 0;
}

function jobOrphanedCount(job: Job): number {
  return job.stats?.orphaned ?? 0;
}

function effectiveJobStatus(job: Job): JobStatus {
  if (job.status === "completed") {
    if (jobTypeOf(job) === "verify_captions" && jobVerifyErrorCount(job) > 0) {
      return "failed";
    }
    if (jobTypeOf(job) === "auto_caption" && jobCaptionErrorCount(job) > 0) {
      return "failed";
    }
    if (jobApiErrorCount(job) > 0) {
      return "failed";
    }
  }
  return job.status;
}

export function jobShowsErrorState(job: Job): boolean {
  const status = effectiveJobStatus(job);
  return status === "failed" || status === "interrupted";
}

export function jobShowsWarningState(job: Job): boolean {
  if (jobShowsErrorState(job) || jobIsCancelled(job)) {
    return false;
  }

  if (job.status !== "completed") {
    return false;
  }

  const type = jobTypeOf(job);

  if (type === "restore_captions") {
    return jobOrphanedCount(job) > 0;
  }

  if (
    type === "strip_metadata" ||
    type === "set_captions" ||
    type === "batch_rename" ||
    type === "backup_captions" ||
    type === "train_lora" ||
    type === "watermark"
  ) {
    return false;
  }

  if (type === "auto_caption") {
    return jobNoCaptionCount(job) + jobNoAudioCount(job) > 0;
  }

  if (type === "edit_captions") {
    return jobNoCaptionCount(job) + jobRejectedCount(job) > 0;
  }

  return jobNoCaptionCount(job) > 0;
}

function noCaptionWarning(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) {
    return `1 file had no caption sidecar (${CAPTION_SIDECAR_EXTENSION_LIST}) and was skipped.`;
  }
  return `${count} files had no caption sidecar (${CAPTION_SIDECAR_EXTENSION_LIST}) and were skipped.`;
}

function rejectedWarning(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) {
    return "1 caption came back in a form the job would not write, and was left unchanged.";
  }
  return `${count} captions came back in a form the job would not write, and were left unchanged.`;
}

function noAudioWarning(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) {
    return "1 video had no audio track and was captioned without it.";
  }
  return `${count} videos had no audio track and were captioned without them.`;
}

export function jobErrorMessage(job: Job): string | null {
  return job.error ?? null;
}

export function jobWarningMessage(job: Job): string | null {
  if (!jobShowsWarningState(job)) {
    return null;
  }

  if (jobTypeOf(job) === "restore_captions") {
    const orphaned = jobOrphanedCount(job);
    if (orphaned === 1) {
      return "1 backed up caption had no matching media file and was skipped.";
    }
    return `${orphaned} backed up captions had no matching media file and were skipped.`;
  }

  const parts = [noCaptionWarning(jobNoCaptionCount(job))];
  if (jobTypeOf(job) === "auto_caption") {
    parts.push(noAudioWarning(jobNoAudioCount(job)));
  }
  if (jobTypeOf(job) === "edit_captions") {
    parts.push(rejectedWarning(jobRejectedCount(job)));
  }

  return parts.filter((part): part is string => part !== null).join(" ") || null;
}

export function progressPercent(job: Job): number {
  if (!job.total) return 0;
  return Math.min(100, Math.round((job.processed / job.total) * 100));
}

export function jobIsCancelled(job: Job): boolean {
  return effectiveJobStatus(job) === "cancelled";
}

export function statusLabel(job: Job): string {
  const status = effectiveJobStatus(job);

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

  return statusTone(effectiveJobStatus(job));
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

function jobTimingCounts(job: Job): { fast: number; slow: number } {
  const stats = job.stats ?? {};
  const type = jobTypeOf(job);

  if (type === "strip_metadata") {
    const slow = (stats.success ?? 0) + (stats.write_error ?? 0) + (stats.ffmpeg_error ?? 0);
    const fast = stats.read_error ?? 0;
    return { fast, slow };
  }

  if (type === "set_captions") {
    const slow = (stats.success ?? 0) + (stats.write_error ?? 0);
    const fast = stats.skipped ?? 0;
    return { fast, slow };
  }

  if (type === "batch_rename") {
    const slow = (stats.success ?? 0) + (stats.rename_error ?? 0);
    return { fast: stats.cancelled ?? 0, slow };
  }

  // Watermark videos are slow; treating stills the same wrecks the remaining-time estimate.
  if (type === "watermark") {
    const slow = (stats.video_success ?? 0) + (stats.ffmpeg_error ?? 0);
    const fast = (stats.image_success ?? 0) + (stats.read_error ?? 0) + (stats.write_error ?? 0);
    return { fast, slow };
  }

  if (type === "backup_captions" || type === "restore_captions") {
    return { fast: job.processed, slow: 0 };
  }

  if (type === "verify_captions") {
    const slow =
      (stats.success ?? 0) +
      (stats.api_error ?? 0) +
      (stats.parse_error ?? 0) +
      (stats.frame_error ?? 0) +
      (stats.read_error ?? 0) +
      (stats.write_error ?? 0);
    const fast = jobNoCaptionCount(job);
    return { fast, slow };
  }

  const fast = jobNoCaptionCount(job) + (stats.skipped_long ?? 0);
  const slow =
    (stats.success ?? 0) +
    (stats.api_error ?? 0) +
    (stats.frame_error ?? 0) +
    (stats.too_short ?? 0) +
    (stats.rejected ?? 0) +
    (stats.unchanged ?? 0) +
    (stats.read_error ?? 0) +
    (stats.write_error ?? 0);

  return { fast, slow };
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
  const counts = jobTimingCounts(job);
  const trackedSlow = tracker?.slowItems ?? 0;
  const slowCompleted = Math.max(counts.slow, trackedSlow);

  if (slowCompleted < 1) {
    if (counts.fast + counts.slow === 0 && trackedSlow < 1) {
      return Math.ceil(remainingItems * (elapsedSeconds / job.processed));
    }
    return null;
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

export function jobCompletionNotification(job: Job): JobCompletionNotification | null {
  if (!isTerminalJobStatus(job.status)) {
    return null;
  }

  const folderLabel = job.folder_name || folderLeafName(job.folder);
  const typeLabel = jobTypeLabel(job);

  if (jobShowsErrorState(job)) {
    const detail = jobErrorMessage(job);
    const message = detail
      ? `${typeLabel} failed in "${folderLabel}": ${detail}`
      : `${typeLabel} failed in "${folderLabel}".`;
    return { variant: "danger", message };
  }

  if (jobIsCancelled(job)) {
    return {
      variant: "warning",
      message: `${typeLabel} cancelled in "${folderLabel}".`,
    };
  }

  if (jobShowsWarningState(job)) {
    const detail = jobWarningMessage(job);
    const message = detail
      ? `${typeLabel} finished with warnings in "${folderLabel}": ${detail}`
      : `${typeLabel} finished with warnings in "${folderLabel}".`;
    return { variant: "warning", message };
  }

  return {
    variant: "success",
    message: `${typeLabel} completed in "${folderLabel}".`,
  };
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
