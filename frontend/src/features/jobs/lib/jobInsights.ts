import { formatCount, formatModifiedAt, formatRelativeTime } from "@/shared/lib/format";
import type { Job } from "@/shared/types";
import { cancelledCountFromStats, failedCountFromStats, SKIPPED_STATUSES } from "./jobFileResults";
import { isUnseenJob, jobFinishedMs } from "./jobSeen";
import {
  isActiveJobStatus,
  isTerminalJobStatus,
  jobElapsedSeconds,
  jobTypeOf,
  parseJobTimestamp,
} from "./jobs";

export interface JobOutcomeMix {
  done: number;
  skipped: number;
  failed: number;
  /** Files a cancel left unrun, the interrupted one included. */
  notRun: number;
}

function stat(job: Job, key: string): number {
  return job.stats?.[key] ?? 0;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function jobUnitWord(job: Job, count: number): string {
  return jobTypeOf(job) === "train_lora"
    ? count === 1
      ? "step"
      : "steps"
    : count === 1
      ? "file"
      : "files";
}

/**
 * A finished run's per-file outcome, read from its counters so no result list is fetched.
 * `done` is the remainder: sub-stats such as `image_success` would otherwise count twice.
 */
export function jobOutcomeMix(job: Job): JobOutcomeMix | null {
  if (!isTerminalJobStatus(job.status) || jobTypeOf(job) === "train_lora") return null;

  const failed = failedCountFromStats(job.stats);
  const notRun = cancelledCountFromStats(job.stats);
  const skipped = Object.entries(job.stats ?? {})
    .filter(([key]) => SKIPPED_STATUSES.has(key))
    .reduce((total, [, count]) => total + (count || 0), 0);
  // Some jobs count the interrupted file as processed; it is already in `notRun`.
  const reached = job.total > 0 ? Math.min(job.processed, job.total - notRun) : job.processed;
  const done = Math.max(0, reached - failed - skipped);

  if (done + skipped + failed + notRun === 0) return null;
  return { done, skipped, failed, notRun };
}

/** The one fact a job type's counters say beyond the file mix, or null. */
export function jobHeadline(job: Job): string | null {
  if (!isTerminalJobStatus(job.status)) return null;

  switch (jobTypeOf(job)) {
    case "find_duplicates": {
      const duplicates = stat(job, "duplicate");
      if (duplicates === 0) return "No duplicates found";
      return `${plural(duplicates, "duplicate")} in ${plural(stat(job, "group"), "group")}`;
    }
    case "verify_captions":
    case "check_caption_rules": {
      const issues = stat(job, "issues_found");
      return issues === 0 ? "No caption issues found" : `${plural(issues, "caption")} flagged`;
    }
    default:
      return null;
  }
}

function formatRate(secondsPerUnit: number, unit: string): string {
  if (secondsPerUnit >= 10) return `${Math.round(secondsPerUnit)} s/${unit}`;
  if (secondsPerUnit >= 1) return `${secondsPerUnit.toFixed(1)} s/${unit}`;
  return `${Math.round(1 / secondsPerUnit)} ${unit}s/s`;
}

/** How fast the finished run went: training's own step speed, otherwise wall clock per file. */
export function jobThroughputLabel(job: Job): string | null {
  if (!isTerminalJobStatus(job.status)) return null;

  if (jobTypeOf(job) === "train_lora") {
    const speedMs = stat(job, "speed_ms_per_step");
    return speedMs > 0 ? formatRate(speedMs / 1000, "step") : null;
  }

  const elapsed = jobElapsedSeconds(job);
  if (elapsed === null || elapsed <= 0 || job.processed < 2) return null;
  return formatRate(elapsed / job.processed, "file");
}

export interface JobWhen {
  label: string;
  /** The absolute time, for a tooltip. */
  title: string | null;
}

/** "Finished 5 minutes ago", or when it started while it runs. */
export function jobWhenLabel(job: Job, nowMs = Date.now()): JobWhen | null {
  const finishedMs = jobFinishedMs(job);
  const startedMs = parseJobTimestamp(job.started_at);
  const [verb, ms] =
    finishedMs !== null
      ? ["Finished", finishedMs]
      : job.status === "queued" || startedMs === null
        ? ["Queued", parseJobTimestamp(job.created_at)]
        : ["Started", startedMs];
  if (ms === null) return null;

  const iso = new Date(ms).toISOString();
  const relative = formatRelativeTime(iso, nowMs);
  return relative ? { label: `${verb} ${relative}`, title: formatModifiedAt(iso) } : null;
}

export type JobSectionId = "running" | "new" | "today" | "yesterday" | "earlier";

export interface JobSection {
  id: JobSectionId;
  label: string;
  jobs: Job[];
}

const SECTION_LABELS: Record<JobSectionId, string> = {
  running: "Running",
  new: "New",
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

const SECTION_ORDER: readonly JobSectionId[] = ["running", "new", "today", "yesterday", "earlier"];

function startOfDay(ms: number, daysBack = 0): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysBack);
  return date.getTime();
}

/** Buckets jobs for the drawer, keeping the given order inside each bucket. */
export function groupJobsForDrawer(
  jobs: readonly Job[],
  seenAtMs: number,
  nowMs = Date.now(),
): JobSection[] {
  const today = startOfDay(nowMs);
  const yesterday = startOfDay(nowMs, 1);
  const buckets = new Map<JobSectionId, Job[]>(SECTION_ORDER.map((id) => [id, []]));

  for (const job of jobs) {
    const time = jobFinishedMs(job) ?? parseJobTimestamp(job.created_at) ?? 0;
    const id: JobSectionId = isActiveJobStatus(job.status)
      ? "running"
      : isUnseenJob(job, seenAtMs)
        ? "new"
        : time >= today
          ? "today"
          : time >= yesterday
            ? "yesterday"
            : "earlier";
    buckets.get(id)!.push(job);
  }

  return SECTION_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    jobs: buckets.get(id)!,
  })).filter((section) => section.jobs.length > 0);
}
