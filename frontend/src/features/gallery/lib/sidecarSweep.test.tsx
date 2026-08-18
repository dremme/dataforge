import { describe, expect, it } from "vitest";
import type { SidecarDeleteResponse } from "@/shared/types";
import { sidecarSweepDetail, sidecarSweepOutcome } from "./sidecarSweep";

function result(overrides: Partial<SidecarDeleteResponse> = {}): SidecarDeleteResponse {
  return {
    folder: "C:\\Photos",
    kind: "issue",
    deleted: ["sunset.issue.json", "beach.issue.json", "waves.issue.json"],
    failed: [],
    deletes_to_trash: true,
    ...overrides,
  };
}

describe("sidecarSweepDetail", () => {
  it("says there is nothing to delete at zero", () => {
    expect(sidecarSweepDetail("issue", 0)).toBe("Nothing to delete");
    expect(sidecarSweepDetail("duplicate", 0)).toBe("Nothing to delete");
  });

  it("uses the singular noun at one", () => {
    expect(sidecarSweepDetail("issue", 1)).toBe("1 caption issue file");
    expect(sidecarSweepDetail("duplicate", 1)).toBe("1 duplicate finding file");
  });

  it("uses the plural noun for more than one", () => {
    expect(sidecarSweepDetail("issue", 3)).toBe("3 caption issue files");
    expect(sidecarSweepDetail("duplicate", 3)).toBe("3 duplicate finding files");
  });
});

describe("sidecarSweepOutcome", () => {
  it("reports a partial sweep as danger and names the first failure", () => {
    expect(
      sidecarSweepOutcome(
        result({
          deleted: ["sunset.issue.json", "beach.issue.json"],
          failed: ["waves.issue.json", "lake.issue.json", "road.issue.json"],
        }),
      ),
    ).toEqual({
      variant: "danger",
      message: "Deleted 2 of 5 caption issue files. Could not delete waves.issue.json and 2 more.",
    });
  });

  it("names a single failure without an and-more clause", () => {
    expect(
      sidecarSweepOutcome(
        result({
          deleted: ["sunset.issue.json"],
          failed: ["waves.issue.json"],
        }),
      ),
    ).toEqual({
      variant: "danger",
      message: "Deleted 1 of 2 caption issue files. Could not delete waves.issue.json.",
    });
  });

  it("warns when the folder had nothing to delete", () => {
    expect(sidecarSweepOutcome(result({ deleted: [] }))).toEqual({
      variant: "warning",
      message: "No caption issue files in this folder.",
    });
  });

  it("names the Recycle Bin when the sweep can be undone", () => {
    expect(sidecarSweepOutcome(result())).toEqual({
      variant: "success",
      message: "Moved 3 caption issue files to the Recycle Bin.",
    });
  });

  it("says deleted when the sweep is permanent", () => {
    expect(sidecarSweepOutcome(result({ deletes_to_trash: false }))).toEqual({
      variant: "success",
      message: "Deleted 3 caption issue files.",
    });
  });
});
