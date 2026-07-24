import type { AppIcon } from "@/shared/icons";
import type { Job, JobStatus, JobType } from "@/shared/types";
import { folderLeafName, foldersMatch } from "@/features/browse/lib/folderPath";
import { jobTypeIconFor, jobTypeLabelFor, PRIMARY_JOB_TYPE } from "./jobMeta";

export type JobCompletionNotificationVariant = "danger" | "warning" | "success";

export interface JobCompletionNotification {
  variant: JobCompletionNotificationVariant;
  message: string;
}

export function jobTypeOf(job: Job): JobType {
  return job.job_type ?? PRIMARY_JOB_TYPE;
}

export function jobTypeLabel(job: Job): string {
  return jobTypeLabelFor(jobTypeOf(job));
}

export function jobIcon(job: Job): AppIcon {
  return jobTypeIconFor(jobTypeOf(job));
}

export function compareJobRecency(a: Job, b: Job): number {
  const aCreated = Date.parse(a.created_at);
  const bCreated = Date.parse(b.created_at);
  const aTime = Number.isNaN(aCreated) ? 0 : aCreated;
  const bTime = Number.isNaN(bCreated) ? 0 : bCreated;
  return bTime - aTime;
}

/** Prefer an active job for the folder; otherwise the most recently created job. */
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

export function jobApiErrorCount(job: Job): number {
  return job.stats?.api_error ?? 0;
}

export function jobHasApiErrors(job: Job): boolean {
  return jobApiErrorCount(job) > 0;
}

export function jobParseErrorCount(job: Job): number {
  return job.stats?.parse_error ?? 0;
}

export function jobVerifyErrorCount(job: Job): number {
  const stats = job.stats ?? {};
  return (
    (stats.api_error ?? 0) +
    (stats.parse_error ?? 0) +
    (stats.read_error ?? 0) +
    (stats.frame_error ?? 0)
  );
}

export function jobNoTxtCount(job: Job): number {
  return job.stats?.no_txt ?? 0;
}

export function jobHasMissingCaptions(job: Job): boolean {
  return jobNoTxtCount(job) > 0;
}

export function jobDetectionErrorCount(job: Job): number {
  return job.stats?.detection_error ?? 0;
}

export function jobHasDetectionErrors(job: Job): boolean {
  return jobDetectionErrorCount(job) > 0;
}

export function jobNoDetectionsCount(job: Job): number {
  return job.stats?.no_detections ?? 0;
}

export function jobHasNoDetections(job: Job): boolean {
  return jobNoDetectionsCount(job) > 0;
}

export function effectiveJobStatus(job: Job): JobStatus {
  if (job.status === "completed") {
    if (jobTypeOf(job) === "verify_captions" && jobVerifyErrorCount(job) > 0) {
      return "failed";
    }
    if (jobHasApiErrors(job)) {
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

  if (jobTypeOf(job) === "body_parts") {
    return jobHasDetectionErrors(job) || jobHasNoDetections(job);
  }

  if (
    jobTypeOf(job) === "strip_metadata" ||
    jobTypeOf(job) === "set_captions" ||
    jobTypeOf(job) === "batch_rename"
  ) {
    return false;
  }

  if (jobTypeOf(job) === "verify_captions") {
    return jobHasMissingCaptions(job);
  }

  return jobHasMissingCaptions(job);
}

export function jobErrorMessage(job: Job): string | null {
  return job.error ?? null;
}

export function jobWarningMessage(job: Job): string | null {
  if (!jobShowsWarningState(job)) {
    return null;
  }

  if (
    jobTypeOf(job) === "strip_metadata" ||
    jobTypeOf(job) === "set_captions" ||
    jobTypeOf(job) === "batch_rename"
  ) {
    return null;
  }

  if (jobTypeOf(job) === "verify_captions") {
    const count = jobNoTxtCount(job);
    if (count === 1) {
      return "1 file had no caption sidecar (.txt) and was skipped.";
    }
    if (count > 1) {
      return `${count} files had no caption sidecar (.txt) and were skipped.`;
    }
    return null;
  }

  if (jobTypeOf(job) === "body_parts") {
    const detectionErrors = jobDetectionErrorCount(job);
    const noDetections = jobNoDetectionsCount(job);

    if (detectionErrors > 0 && noDetections > 0) {
      return `${detectionErrors} image${detectionErrors === 1 ? "" : "s"} failed detection; ${noDetections} had no body parts detected.`;
    }
    if (detectionErrors === 1) {
      return "1 image failed body-parts detection.";
    }
    if (detectionErrors > 1) {
      return `${detectionErrors} images failed body-parts detection.`;
    }
    if (noDetections === 1) {
      return "1 image had no body parts detected.";
    }
    if (noDetections > 1) {
      return `${noDetections} images had no body parts detected.`;
    }
    return null;
  }

  const count = jobNoTxtCount(job);
  if (count === 1) {
    return "1 file had no caption sidecar (.txt) and was skipped.";
  }

  return `${count} files had no caption sidecar (.txt) and were skipped.`;
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

export function statusTone(
  status: JobStatus,
): "active" | "success" | "danger" | "warning" | "muted" {
  if (isActiveJobStatus(status)) return "active";
  if (status === "completed") return "success";
  if (status === "failed" || status === "interrupted") return "danger";
  if (status === "cancelled") return "warning";
  return "muted";
}

export function jobStatusTone(job: Job): "active" | "success" | "danger" | "warning" | "muted" {
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

export function jobTimingCounts(job: Job): { fast: number; slow: number } {
  const stats = job.stats ?? {};

  if (jobTypeOf(job) === "body_parts") {
    const fast = (stats.no_detections ?? 0) + (stats.read_error ?? 0);
    const slow = (stats.success ?? 0) + (stats.detection_error ?? 0) + (stats.write_error ?? 0);
    return { fast, slow };
  }

  if (jobTypeOf(job) === "strip_metadata") {
    const slow = (stats.success ?? 0) + (stats.write_error ?? 0) + (stats.ffmpeg_error ?? 0);
    const fast = stats.read_error ?? 0;
    return { fast, slow };
  }

  if (jobTypeOf(job) === "set_captions") {
    const slow = (stats.success ?? 0) + (stats.write_error ?? 0);
    const fast = stats.skipped ?? 0;
    return { fast, slow };
  }

  if (jobTypeOf(job) === "batch_rename") {
    const slow = (stats.success ?? 0) + (stats.rename_error ?? 0);
    return { fast: stats.cancelled ?? 0, slow };
  }

  if (jobTypeOf(job) === "verify_captions") {
    const slow =
      (stats.success ?? 0) +
      (stats.api_error ?? 0) +
      (stats.parse_error ?? 0) +
      (stats.write_error ?? 0);
    const fast = stats.no_txt ?? 0;
    return { fast, slow };
  }

  const fast = (stats.no_txt ?? 0) + (stats.skipped_long ?? 0);
  const slow =
    (stats.success ?? 0) +
    (stats.api_error ?? 0) +
    (stats.frame_error ?? 0) +
    (stats.too_short ?? 0) +
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

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));

  if (seconds < 60) {
    return seconds <= 1 ? "1s" : `${seconds}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return minutes === 1 ? "1 min" : `${minutes} min`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (minutes === 0) {
    return hours === 1 ? "1 hr" : `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
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

  const startIso = job.started_at ?? job.created_at;
  const startedMs = Date.parse(startIso);
  if (Number.isNaN(startedMs)) {
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

  const remainingSeconds = jobRemainingSeconds(job, nowMs, tracker);
  if (remainingSeconds === null) {
    return "Estimating...";
  }

  if (remainingSeconds <= 1) {
    return "<1 min left";
  }

  return `~${formatDuration(remainingSeconds)} left`;
}
