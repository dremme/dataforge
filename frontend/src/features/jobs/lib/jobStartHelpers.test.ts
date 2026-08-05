import { describe, expect, it } from "vitest";
import type { Job } from "@/shared/types";
import {
  clearStartingJobIfMatch,
  isStartingJobForFolder,
  upsertStartedJob,
} from "./jobStartHelpers";

function job(id: string, folder: string, jobType: Job["job_type"]): Job {
  return {
    id,
    folder,
    job_type: jobType,
    status: "queued",
    total: 0,
    processed: 0,
    stats: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("upsertStartedJob", () => {
  it("prepends the new job and removes prior jobs of the same type in the folder", () => {
    const existing = [
      job("old", "C:\\Photos", "verify_captions"),
      job("other", "C:\\Photos\\Vacation", "verify_captions"),
    ];

    const next = job("new", "C:\\Photos", "verify_captions");
    const result = upsertStartedJob(existing, next, "C:\\Photos", "verify_captions");

    expect(result.map((entry) => entry.id)).toEqual(["new", "other"]);
  });
});

describe("isStartingJobForFolder", () => {
  it("matches only the requested folder and job type", () => {
    const startingJob = { folder: "C:\\Photos", jobType: "strip_metadata" as const };

    expect(isStartingJobForFolder(startingJob, "C:\\Photos", "strip_metadata")).toBe(true);
    expect(isStartingJobForFolder(startingJob, "C:\\Photos", "verify_captions")).toBe(false);
    expect(isStartingJobForFolder(startingJob, "C:\\Photos\\Vacation", "strip_metadata")).toBe(
      false,
    );
  });
});

describe("clearStartingJobIfMatch", () => {
  it("clears only the matching starting job", () => {
    const startingJob = { folder: "C:\\Photos", jobType: "auto_caption" as const };

    expect(clearStartingJobIfMatch(startingJob, "C:\\Photos", "auto_caption")).toBeNull();
    expect(clearStartingJobIfMatch(startingJob, "C:\\Photos", "verify_captions")).toBe(startingJob);
  });
});
