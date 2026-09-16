import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_JOB_FILTERS } from "./jobFilters";
import { cacheJobFilters, readJobFilters } from "./jobFilterPreferences";

const JOB_FILTERS_CACHE_KEY = "jobs-drawer-filters";

describe("job filter preferences", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("starts from the defaults", () => {
    expect(readJobFilters()).toEqual(DEFAULT_JOB_FILTERS);
  });

  it("round-trips through session storage", () => {
    const filters = { jobType: "watermark", status: "failed", folder: "current" } as const;

    cacheJobFilters(filters);

    expect(window.sessionStorage.getItem(JOB_FILTERS_CACHE_KEY)).toBe(JSON.stringify(filters));
    expect(readJobFilters()).toEqual(filters);
  });

  it("falls back per field for values this build does not know", () => {
    window.sessionStorage.setItem(
      JOB_FILTERS_CACHE_KEY,
      JSON.stringify({ jobType: "body_parts", status: "failed", folder: 3 }),
    );

    expect(readJobFilters()).toEqual({ ...DEFAULT_JOB_FILTERS, status: "failed" });
  });

  it("ignores a value that is not an object", () => {
    window.sessionStorage.setItem(JOB_FILTERS_CACHE_KEY, "not json");

    expect(readJobFilters()).toEqual(DEFAULT_JOB_FILTERS);
  });
});
