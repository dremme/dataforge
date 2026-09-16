import { describe, expect, it } from "vitest";
import { clearStartingJobIfMatch, isStartingJobForFolder } from "./jobStartHelpers";

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
