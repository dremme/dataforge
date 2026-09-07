import { describe, expect, it } from "vitest";
import type { JobFileResult } from "@/shared/types";
import {
  countFailedResults,
  failedResultPaths,
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

  it("orders failures first, then skips, then successes", () => {
    const results = [
      makeResult("done.png", "success"),
      makeResult("skipped.png", "skipped"),
      makeResult("broken.png", "write_error"),
      makeResult("also-done.png", "success"),
    ];

    expect(sortResultsForDisplay(results).map((result) => result.name)).toEqual([
      "broken.png",
      "skipped.png",
      "done.png",
      "also-done.png",
    ]);
  });

  it("leaves training samples out of the list", () => {
    const results = [makeResult("sample.jpg", "sample"), makeResult("done.png", "success")];

    expect(sortResultsForDisplay(results).map((result) => result.name)).toEqual(["done.png"]);
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
