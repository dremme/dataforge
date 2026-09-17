import { describe, expect, it } from "vitest";
import type { JobFileResult } from "@/shared/types";
import {
  cancelledCountFromStats,
  countFailedResults,
  failedResultPaths,
  groupResultsForDisplay,
  isFailedResult,
  isSkippedResult,
  resultStatusLabel,
  sortResultsForDisplay,
} from "./jobFileResults";

function makeResult(name: string, status: string): JobFileResult {
  return { path: `C:\\Photos\\${name}`, name, status };
}

describe("jobFileResults", () => {
  it("treats every error status as a failure", () => {
    for (const status of ["read_error", "write_error", "api_error", "comfy_error"]) {
      expect(isFailedResult(makeResult("a.png", status))).toBe(true);
    }
    expect(isFailedResult(makeResult("a.png", "too_short"))).toBe(true);
    expect(isFailedResult(makeResult("a.png", "rejected"))).toBe(true);
  });

  it("does not count a skip or a success as a failure", () => {
    expect(isFailedResult(makeResult("a.png", "skipped"))).toBe(false);
    expect(isFailedResult(makeResult("a.png", "success"))).toBe(false);
    expect(isSkippedResult(makeResult("a.png", "no_caption"))).toBe(true);
    expect(isSkippedResult(makeResult("a.png", "success"))).toBe(false);
  });

  it("names known statuses and humanises unknown ones", () => {
    expect(resultStatusLabel("write_error")).toBe("Write error");
    expect(resultStatusLabel("api_error")).toBe("Model error");
    expect(resultStatusLabel("brand_new_status")).toBe("Brand new status");
  });

  it("orders failures, cancellations, successes, then skips and preserves order within groups", () => {
    const results = [
      makeResult("done.png", "success"),
      makeResult("skipped.png", "skipped"),
      makeResult("broken.png", "write_error"),
      makeResult("also-done.png", "success"),
      makeResult("interrupted.png", "cancelled"),
    ];

    expect(sortResultsForDisplay(results).map((result) => result.name)).toEqual([
      "broken.png",
      "interrupted.png",
      "done.png",
      "also-done.png",
      "skipped.png",
    ]);
  });

  it("leaves training samples out of the list", () => {
    const results = [makeResult("sample.jpg", "sample"), makeResult("done.png", "success")];

    expect(sortResultsForDisplay(results).map((result) => result.name)).toEqual(["done.png"]);
  });

  it("groups outcomes with the ones needing attention first", () => {
    const groups = groupResultsForDisplay(
      sortResultsForDisplay([
        makeResult("done.png", "success"),
        makeResult("skipped.png", "skipped"),
        makeResult("broken.png", "write_error"),
        makeResult("interrupted.png", "cancelled"),
      ]),
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Failed",
      "Not run",
      "Completed",
      "Skipped",
    ]);
    expect(groups.map((group) => group.tone)).toEqual(["failed", "cancelled", "done", "skipped"]);
    expect(groups.map((group) => group.results.map((result) => result.name))).toEqual([
      ["broken.png"],
      ["interrupted.png"],
      ["done.png"],
      ["skipped.png"],
    ]);
  });

  it("leaves out an outcome the job never produced", () => {
    const groups = groupResultsForDisplay([
      makeResult("a.png", "success"),
      makeResult("b.png", "success"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tone: "done", label: "Completed", count: 2 });
    expect(groups[0].results).toHaveLength(2);
  });

  it("files an unrecognised status under Completed rather than dropping it", () => {
    const groups = groupResultsForDisplay([makeResult("a.png", "brand_new_status")]);

    expect(groups.map((group) => group.tone)).toEqual(["done"]);
  });

  it("groups nothing when there are no results", () => {
    expect(groupResultsForDisplay([])).toEqual([]);
  });

  it("files an interrupted run under Not run rather than Skipped", () => {
    const cancelled = makeResult("interrupted.png", "cancelled");

    expect(isSkippedResult(cancelled)).toBe(false);
    expect(groupResultsForDisplay([cancelled], 1)).toMatchObject([
      { tone: "cancelled", label: "Not run", count: 1 },
    ]);
  });

  it("counts the files a cancel left unrun from the job's counter, not the rows", () => {
    const groups = groupResultsForDisplay(
      sortResultsForDisplay([
        makeResult("done.png", "success"),
        makeResult("interrupted.png", "cancelled"),
      ]),
      189,
    );

    expect(groups.map((group) => [group.tone, group.count])).toEqual([
      ["cancelled", 189],
      ["done", 1],
    ]);
    expect(groups[0].results.map((result) => result.name)).toEqual(["interrupted.png"]);
  });

  it("names the Not run group even when the cancel landed between files", () => {
    const groups = groupResultsForDisplay([makeResult("done.png", "success")], 189);

    expect(groups.map((group) => [group.tone, group.count])).toEqual([
      ["cancelled", 189],
      ["done", 1],
    ]);
    expect(groups[0].results).toEqual([]);
  });

  it("reads the unrun count off the job's stats", () => {
    expect(cancelledCountFromStats({ total: 200, success: 11, cancelled: 189 })).toBe(189);
    expect(cancelledCountFromStats({ total: 3, success: 3 })).toBe(0);
    expect(cancelledCountFromStats(undefined)).toBe(0);
  });

  it("collects the paths of failed files only", () => {
    const results = [
      makeResult("done.png", "success"),
      makeResult("broken.png", "api_error"),
      makeResult("skipped.png", "skipped"),
    ];

    expect(failedResultPaths(results)).toEqual(["C:\\Photos\\broken.png"]);
    expect(countFailedResults(results)).toBe(1);
  });
});
