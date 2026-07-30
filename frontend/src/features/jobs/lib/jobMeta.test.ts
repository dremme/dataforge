import { describe, expect, it } from "vitest";
import type { JobType } from "@/shared/types";
import { SECONDARY_JOB_TYPES, isJobAvailable } from "./jobMeta";

const withBackup = { hasCaptionBackup: true };
const withoutBackup = { hasCaptionBackup: false };

describe("isJobAvailable", () => {
  it("blocks restore captions until a backup exists", () => {
    expect(isJobAvailable("restore_captions", withoutBackup)).toBe(false);
    expect(isJobAvailable("restore_captions", withBackup)).toBe(true);
  });

  it("leaves every other job available either way", () => {
    const others = SECONDARY_JOB_TYPES.filter((type) => type !== "restore_captions");
    expect(others.length).toBeGreaterThan(0);

    for (const type of others) {
      expect(isJobAvailable(type, withoutBackup)).toBe(true);
      expect(isJobAvailable(type, withBackup)).toBe(true);
    }
  });

  it("tolerates a job type the registry does not know", () => {
    expect(isJobAvailable("legacy_job" as JobType, withoutBackup)).toBe(true);
  });
});
