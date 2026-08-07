import { afterEach, describe, expect, it } from "vitest";
import { claimJobCompletionNotification } from "./jobCompletionNotifyClaim";

afterEach(() => {
  localStorage.clear();
});

describe("claimJobCompletionNotification", () => {
  it("allows the first claim and rejects a repeat for the same job and status", () => {
    expect(claimJobCompletionNotification("job-1", "completed", 1_000)).toBe(true);
    expect(claimJobCompletionNotification("job-1", "completed", 1_001)).toBe(false);
  });

  it("allows a different status or job id", () => {
    expect(claimJobCompletionNotification("job-1", "completed", 1_000)).toBe(true);
    expect(claimJobCompletionNotification("job-1", "failed", 1_001)).toBe(true);
    expect(claimJobCompletionNotification("job-2", "completed", 1_002)).toBe(true);
  });

  it("forgets claims older than a day so the map cannot grow forever", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    expect(claimJobCompletionNotification("job-1", "completed", 1_000)).toBe(true);
    expect(claimJobCompletionNotification("job-1", "completed", 1_000 + dayMs + 1)).toBe(true);
  });
});
