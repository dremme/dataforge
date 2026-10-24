import { describe, expect, it } from "vitest";
import { reviewScopeFor, reviewScopeNote, reviewScopeSuffix } from "./reviewScope";

describe("reviewScope", () => {
  it("follows the job rule: selection, then search and filters, then the folder", () => {
    expect(reviewScopeFor(2, true, 5, 9)).toEqual({ kind: "selected", fileCount: 2 });
    expect(reviewScopeFor(0, true, 5, 9)).toEqual({ kind: "matching", fileCount: 5 });
    expect(reviewScopeFor(0, false, 9, 9)).toEqual({ kind: "folder", fileCount: 9 });
  });

  it("names a narrowed scope wherever a count is shown", () => {
    expect(reviewScopeSuffix({ kind: "matching", fileCount: 5 })).toBe(" in 5 matching files");
    expect(reviewScopeSuffix({ kind: "selected", fileCount: 1 })).toBe(" in 1 selected file");
    expect(reviewScopeSuffix({ kind: "folder", fileCount: 9 })).toBe("");
    expect(reviewScopeNote({ kind: "matching", fileCount: 5 })).toBe(
      "5 files matching the search and filters",
    );
  });
});
