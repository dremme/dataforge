import { describe, expect, it } from "vitest";
import { job } from "@/test/fixtures";
import {
  DEFAULT_JOB_FILTERS,
  jobHistoryStatusOf,
  jobsQueryFor,
  matchesJobFilters,
  mergeJobLists,
  toggleJobType,
} from "./jobFilters";

const PHOTOS = "C:\\Photos";

describe("jobHistoryStatusOf", () => {
  it("groups the stored statuses the way the server filter does", () => {
    expect(jobHistoryStatusOf("queued")).toBe("active");
    expect(jobHistoryStatusOf("running")).toBe("active");
    expect(jobHistoryStatusOf("completed")).toBe("completed");
    expect(jobHistoryStatusOf("failed")).toBe("failed");
    expect(jobHistoryStatusOf("cancelled")).toBe("stopped");
    expect(jobHistoryStatusOf("interrupted")).toBe("stopped");
  });
});

describe("jobsQueryFor", () => {
  it("sends nothing for the default filters", () => {
    expect(jobsQueryFor(DEFAULT_JOB_FILTERS, PHOTOS)).toEqual({});
  });

  it("ignores the current-folder filter when no folder is open", () => {
    const filters = { ...DEFAULT_JOB_FILTERS, folder: "current" as const };

    expect(jobsQueryFor(filters, undefined)).toEqual({});
    expect(jobsQueryFor(filters, PHOTOS)).toEqual({ folder: PHOTOS });
  });
});

describe("toggleJobType", () => {
  it("adds and removes a type, keeping option order whatever the click order", () => {
    const picked = toggleJobType(toggleJobType([], "watermark"), "auto_caption");

    expect(picked).toEqual(["auto_caption", "watermark"]);
    expect(toggleJobType(picked, "watermark")).toEqual(["auto_caption"]);
  });
});

describe("matchesJobFilters", () => {
  it("matches any of several types", () => {
    const filters = {
      ...DEFAULT_JOB_FILTERS,
      jobTypes: ["watermark" as const, "auto_caption" as const],
    };

    expect(matchesJobFilters(job({ job_type: "auto_caption" }), filters, PHOTOS)).toBe(true);
    expect(matchesJobFilters(job({ job_type: "watermark" }), filters, PHOTOS)).toBe(true);
    expect(matchesJobFilters(job({ job_type: "strip_metadata" }), filters, PHOTOS)).toBe(false);
  });

  it("applies type, status and folder together", () => {
    const filters = {
      jobTypes: ["watermark" as const],
      status: "stopped" as const,
      folder: "current" as const,
    };

    expect(
      matchesJobFilters(
        job({ job_type: "watermark", status: "interrupted", folder: PHOTOS }),
        filters,
        PHOTOS,
      ),
    ).toBe(true);
    expect(
      matchesJobFilters(
        job({ job_type: "watermark", status: "completed", folder: PHOTOS }),
        filters,
        PHOTOS,
      ),
    ).toBe(false);
    expect(
      matchesJobFilters(
        job({ job_type: "watermark", status: "cancelled", folder: "C:\\Other" }),
        filters,
        PHOTOS,
      ),
    ).toBe(false);
  });
});

describe("mergeJobLists", () => {
  it("prefers the live copy and orders active jobs first, then newest", () => {
    const stale = job({ id: "a", status: "running", created_at: "2026-01-01T00:00:00Z" });
    const live = job({
      id: "a",
      status: "running",
      processed: 5,
      created_at: "2026-01-01T00:00:00Z",
    });
    const newer = job({ id: "b", status: "completed", created_at: "2026-01-03T00:00:00Z" });
    const older = job({ id: "c", status: "failed", created_at: "2026-01-02T00:00:00Z" });

    const merged = mergeJobLists([live], [older, stale, newer]);

    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(merged[0].processed).toBe(5);
  });
});
