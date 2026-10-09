import { describe, expect, it } from "vitest";
import { clearStartingJobIfMatch } from "./jobStartHelpers";

describe("clearStartingJobIfMatch", () => {
  it("clears only the matching starting job", () => {
    const startingJob = { folder: "C:\\Photos", jobType: "auto_caption" as const };

    expect(clearStartingJobIfMatch(startingJob, "C:\\Photos", "auto_caption")).toBeNull();
    expect(clearStartingJobIfMatch(startingJob, "C:\\Photos", "verify_captions")).toBe(startingJob);
  });
});
