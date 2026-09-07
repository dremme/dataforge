import type { JobFileResult } from "@/shared/types";

/** Training samples are media the run produced, not an outcome for a file it read. */
const SAMPLE_STATUS = "sample";

const FAILED_STATUSES = new Set(["too_short", "rejected"]);

const SKIPPED_STATUSES = new Set([
  "skipped",
  "skipped_long",
  "no_caption",
  "already_backed_up",
  "orphaned",
  "unchanged",
  "cancelled",
]);

const STATUS_LABELS: Record<string, string> = {
  already_backed_up: "Already backed up",
  api_error: "Model error",
  cancelled: "Cancelled",
  comfy_error: "ComfyUI error",
  ffmpeg_error: "FFmpeg error",
  frame_error: "Frame error",
  hashed: "Hashed",
  no_caption: "No caption",
  orphaned: "No media file",
  parse_error: "Unreadable reply",
  read_error: "Read error",
  rejected: "Rejected",
  rename_error: "Rename error",
  skipped: "Skipped",
  skipped_long: "Caption long enough",
  success: "Done",
  too_short: "Reply too short",
  unchanged: "Unchanged",
  write_error: "Write error",
};

/** Failures a finished job reports, read from its counters so the list need not be fetched. */
export function failedCountFromStats(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;

  return Object.entries(stats)
    .filter(([key]) => key.endsWith("_error") || FAILED_STATUSES.has(key))
    .reduce((total, [, count]) => total + (count || 0), 0);
}

export function isFailedResult(result: JobFileResult): boolean {
  return result.status.endsWith("_error") || FAILED_STATUSES.has(result.status);
}

export function isSkippedResult(result: JobFileResult): boolean {
  return SKIPPED_STATUSES.has(result.status);
}

export function resultStatusLabel(status: string): string {
  const known = STATUS_LABELS[status];
  if (known) return known;

  const words = status.replace(/_/g, " ").trim();
  if (!words) return status;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function resultRank(result: JobFileResult): number {
  if (isFailedResult(result)) return 0;
  if (isSkippedResult(result)) return 1;
  return 2;
}

/** Failures first, then skips, then the rest; each group keeps the order the job ran in. */
export function sortResultsForDisplay(results: JobFileResult[]): JobFileResult[] {
  return results
    .filter((result) => result.status !== SAMPLE_STATUS)
    .map((result, index) => ({ result, index }))
    .sort((a, b) => resultRank(a.result) - resultRank(b.result) || a.index - b.index)
    .map((entry) => entry.result);
}

export function failedResultPaths(results: JobFileResult[]): string[] {
  return results.filter(isFailedResult).map((result) => result.path);
}

export function countFailedResults(results: JobFileResult[]): number {
  return results.filter(isFailedResult).length;
}
