import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import type { JobsDrawerFilters } from "@/shared/types";
import {
  DEFAULT_JOB_FILTERS,
  JOB_FOLDER_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_TYPE_FILTER_OPTIONS,
  type JobFilters,
} from "./jobFilters";

// Local mirror of the saved UI setting, so the drawer opens filtered before the server answers.
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
  const storedTypes: unknown[] = Array.isArray(parsed.jobTypes) ? parsed.jobTypes : [];
  return {
    jobTypes: JOB_TYPE_FILTER_OPTIONS.map((option) => option.value).filter((type) =>
      storedTypes.includes(type),
    ),
    status: oneOf(JOB_STATUS_FILTER_OPTIONS, parsed.status, DEFAULT_JOB_FILTERS.status),
    folder: oneOf(JOB_FOLDER_FILTER_OPTIONS, parsed.folder, DEFAULT_JOB_FILTERS.folder),
  };
}

export function readJobFilters(): JobFilters {
  return readStoredJson(JOB_FILTERS_CACHE_KEY, parseStoredJobFilters, DEFAULT_JOB_FILTERS);
}

export function cacheJobFilters(filters: JobFilters): void {
  writeStoredJson(JOB_FILTERS_CACHE_KEY, filters);
}

/** Runs the server copy through the same parser, so types this build does not know drop out. */
export function jobFiltersFromWire(filters: JobsDrawerFilters): JobFilters {
  return (
    parseStoredJobFilters({
      jobTypes: filters.job_types,
      status: filters.status,
      folder: filters.folder,
    }) ?? DEFAULT_JOB_FILTERS
  );
}

export function jobFiltersToWire(filters: JobFilters): JobsDrawerFilters {
  return { job_types: filters.jobTypes, status: filters.status, folder: filters.folder };
}
