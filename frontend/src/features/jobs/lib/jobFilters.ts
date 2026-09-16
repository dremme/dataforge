import { foldersMatch } from "@/features/folder/lib/folderPath";
import type { Job, JobHistoryStatus, JobStatus, JobType } from "@/shared/types";
import { jobTypeLabelFor, PRIMARY_JOB_TYPE, SECONDARY_JOB_TYPES } from "./jobMeta";
import { isActiveJobStatus, jobTypeOf } from "./jobs";

export type JobFolderFilter = "all" | "current";

export interface JobFilters {
  jobType: JobType | "all";
  status: JobHistoryStatus | "all";
  folder: JobFolderFilter;
}

export const DEFAULT_JOB_FILTERS: JobFilters = { jobType: "all", status: "all", folder: "all" };

export const JOB_TYPE_FILTER_OPTIONS: ReadonlyArray<{ value: JobType | "all"; title: string }> = [
  { value: "all", title: "All types" },
  ...[PRIMARY_JOB_TYPE, ...SECONDARY_JOB_TYPES].map((type) => ({
    value: type,
    title: jobTypeLabelFor(type),
  })),
];

export const JOB_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: JobHistoryStatus | "all";
  title: string;
}> = [
  { value: "all", title: "All statuses" },
  { value: "active", title: "Active" },
  { value: "completed", title: "Completed" },
  { value: "failed", title: "Failed" },
  { value: "stopped", title: "Cancelled" },
];

export const JOB_FOLDER_FILTER_OPTIONS: ReadonlyArray<{ value: JobFolderFilter; title: string }> = [
  { value: "all", title: "All folders" },
  { value: "current", title: "Current folder" },
];

export interface JobsQuery {
  jobType?: JobType;
  status?: JobHistoryStatus;
  folder?: string;
}

export function isDefaultJobFilters(filters: JobFilters): boolean {
  return filters.jobType === "all" && filters.status === "all" && filters.folder === "all";
}

/** Mirrors the backend's ``_HISTORY_STATUSES``. */
export function jobHistoryStatusOf(status: JobStatus): JobHistoryStatus {
  if (isActiveJobStatus(status)) return "active";
  if (status === "completed" || status === "failed") return status;
  return "stopped";
}

/** The folder filter falls back to all folders when no folder is open. */
export function jobsQueryFor(filters: JobFilters, currentFolder: string | undefined): JobsQuery {
  return {
    ...(filters.jobType !== "all" && { jobType: filters.jobType }),
    ...(filters.status !== "all" && { status: filters.status }),
    ...(filters.folder === "current" && currentFolder && { folder: currentFolder }),
  };
}

export function matchesJobFilters(
  job: Job,
  filters: JobFilters,
  currentFolder: string | undefined,
): boolean {
  const query = jobsQueryFor(filters, currentFolder);
  if (query.jobType && jobTypeOf(job) !== query.jobType) return false;
  if (query.status && jobHistoryStatusOf(job.status) !== query.status) return false;
  if (query.folder && !foldersMatch(job.folder, query.folder)) return false;
  return true;
}

function createdTime(job: Job): number {
  const time = Date.parse(job.created_at);
  return Number.isNaN(time) ? 0 : time;
}

/** Union by id with the live copy winning, in the server's order: active first, then newest. */
export function mergeJobLists(live: readonly Job[], history: readonly Job[]): Job[] {
  const byId = new Map<string, Job>();
  for (const job of history) byId.set(job.id, job);
  for (const job of live) byId.set(job.id, job);

  return [...byId.values()].sort((a, b) => {
    const activeOrder = Number(isActiveJobStatus(b.status)) - Number(isActiveJobStatus(a.status));
    return activeOrder || createdTime(b) - createdTime(a);
  });
}
