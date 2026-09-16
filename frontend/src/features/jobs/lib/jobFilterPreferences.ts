import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import {
  DEFAULT_JOB_FILTERS,
  JOB_FOLDER_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_TYPE_FILTER_OPTIONS,
  type JobFilters,
} from "./jobFilters";

// Session-scoped like the gallery's query, so each tab keeps its own view.
const JOB_FILTERS_CACHE_KEY = "jobs-drawer-filters";

function oneOf<T extends string>(
  options: ReadonlyArray<{ value: T }>,
  value: unknown,
  fallback: T,
): T {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

function parseStoredJobFilters(value: unknown): JobFilters | null {
  if (!value || typeof value !== "object") return null;

  const parsed = value as Record<string, unknown>;
  return {
    jobType: oneOf(JOB_TYPE_FILTER_OPTIONS, parsed.jobType, DEFAULT_JOB_FILTERS.jobType),
    status: oneOf(JOB_STATUS_FILTER_OPTIONS, parsed.status, DEFAULT_JOB_FILTERS.status),
    folder: oneOf(JOB_FOLDER_FILTER_OPTIONS, parsed.folder, DEFAULT_JOB_FILTERS.folder),
  };
}

export function readJobFilters(): JobFilters {
  return readStoredJson(
    JOB_FILTERS_CACHE_KEY,
    parseStoredJobFilters,
    DEFAULT_JOB_FILTERS,
    "session",
  );
}

export function cacheJobFilters(filters: JobFilters): void {
  writeStoredJson(JOB_FILTERS_CACHE_KEY, filters, "session");
}
