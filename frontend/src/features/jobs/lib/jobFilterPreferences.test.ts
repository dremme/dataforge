import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTERS, type JobFilters } from "./jobFilters";
import {
  cacheJobFilters,
  jobFiltersFromWire,
  jobFiltersToWire,
  readJobFilters,
} from "./jobFilterPreferences";

const JOB_FILTERS_CACHE_KEY = "jobs-drawer-filters";

describe("job filter preferences", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts from the defaults", () => {
    expect(readJobFilters()).toEqual(DEFAULT_JOB_FILTERS);
  });

  it("round-trips through local storage", () => {
    const filters = {
      jobTypes: ["auto_caption", "watermark"],
      status: "failed",
      folder: "current",
    } satisfies JobFilters;

    cacheJobFilters(filters);

    expect(window.localStorage.getItem(JOB_FILTERS_CACHE_KEY)).toBe(JSON.stringify(filters));
    expect(readJobFilters()).toEqual(filters);
  });

  it("falls back per field for values this build does not know", () => {
    window.localStorage.setItem(
      JOB_FILTERS_CACHE_KEY,
      JSON.stringify({ jobTypes: ["body_parts", "watermark"], status: "failed", folder: 3 }),
    );

    expect(readJobFilters()).toEqual({
      ...DEFAULT_JOB_FILTERS,
      jobTypes: ["watermark"],
      status: "failed",
    });
  });

  it("converts to and from the wire, dropping types this build does not know", () => {
    const filters = jobFiltersFromWire({
      job_types: ["watermark", "body_parts" as never],
      status: "failed",
      folder: "current",
    });

    expect(filters).toEqual({ jobTypes: ["watermark"], status: "failed", folder: "current" });
    expect(jobFiltersToWire(filters)).toEqual({
      job_types: ["watermark"],
      status: "failed",
      folder: "current",
    });
  });

  it("ignores a value that is not an object", () => {
    window.localStorage.setItem(JOB_FILTERS_CACHE_KEY, "not json");

    expect(readJobFilters()).toEqual(DEFAULT_JOB_FILTERS);
  });
});
