import { afterEach, describe, expect, it, vi } from "vitest";
import { job } from "@/test/fixtures";
import {
  isUnseenJob,
  JOBS_SEEN_AT_KEY,
  nextJobsSeenAt,
  parseJobsSeenAt,
  readJobsSeenAt,
} from "./jobSeen";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readJobsSeenAt", () => {
  it("starts from now on the first run, so old history is not all new", () => {
    expect(readJobsSeenAt(1000)).toBe(1000);
    expect(localStorage.getItem(JOBS_SEEN_AT_KEY)).toBe("1000");
    expect(readJobsSeenAt(5000)).toBe(1000);
  });

  it("falls back to now when storage throws", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readJobsSeenAt(2000)).toBe(2000);
  });

  it("ignores a marker that is not a number", () => {
    localStorage.setItem(JOBS_SEEN_AT_KEY, '"soon"');

    expect(readJobsSeenAt(3000)).toBe(3000);
    expect(parseJobsSeenAt("not json")).toBeNull();
    expect(parseJobsSeenAt(null)).toBeNull();
  });
});

describe("isUnseenJob", () => {
  const finishedAt = Date.parse("2026-03-10T10:00:00.000Z");
  const done = job({ status: "completed", finished_at: "2026-03-10T10:00:00.000Z" });

  it("flags a job that finished after the marker", () => {
    expect(isUnseenJob(done, finishedAt - 1)).toBe(true);
    expect(isUnseenJob(done, finishedAt)).toBe(false);
  });

  it("never flags a running job", () => {
    expect(isUnseenJob({ ...done, status: "running" }, 0)).toBe(false);
  });

  it("reads a zone-less interrupted timestamp as UTC", () => {
    const interrupted = job({ status: "interrupted", finished_at: "2026-03-10 10:00:00" });

    expect(isUnseenJob(interrupted, finishedAt - 1)).toBe(true);
    expect(isUnseenJob(interrupted, finishedAt)).toBe(false);
  });
});

describe("nextJobsSeenAt", () => {
  it("never lands before a shown job's finish, whatever this clock says", () => {
    const ahead = job({ status: "completed", finished_at: "2026-03-10T10:00:00.000Z" });

    expect(nextJobsSeenAt([ahead], 0)).toBe(Date.parse("2026-03-10T10:00:00.000Z"));
    expect(nextJobsSeenAt([ahead], Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("stops short of an unseen job the drawer did not show", () => {
    const shown = job({
      id: "shown",
      status: "completed",
      finished_at: "2026-03-10T10:00:00.000Z",
    });
    const hidden = job({
      id: "hidden",
      status: "completed",
      finished_at: "2026-03-10T09:00:00.000Z",
    });
    const hiddenMs = Date.parse("2026-03-10T09:00:00.000Z");
    const isShown = (entry: { id: string }) => entry.id === "shown";

    const next = nextJobsSeenAt([shown, hidden], Number.MAX_SAFE_INTEGER, isShown, 0);

    expect(isUnseenJob(hidden, next)).toBe(true);
    expect(next).toBe(hiddenMs - 1);
  });

  it("passes a hidden job that was already seen", () => {
    const hidden = job({
      id: "hidden",
      status: "completed",
      finished_at: "2026-03-10T09:00:00.000Z",
    });
    const seenAtMs = Date.parse("2026-03-10T09:30:00.000Z");

    expect(nextJobsSeenAt([hidden], 5e12, () => false, seenAtMs)).toBe(5e12);
  });
});
