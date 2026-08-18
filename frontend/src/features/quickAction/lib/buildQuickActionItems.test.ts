import { describe, expect, it, vi } from "vitest";
import { buildSidecarSweepItems, type SidecarSweepOptions } from "./buildQuickActionItems";

function sweepItems(overrides: Partial<SidecarSweepOptions> = {}) {
  return buildSidecarSweepItems({
    hasFolder: true,
    counts: { issue: 3, duplicate: 2 },
    busy: false,
    onSweep: vi.fn(),
    ...overrides,
  });
}

describe("buildSidecarSweepItems", () => {
  it("offers nothing without a folder", () => {
    expect(sweepItems({ hasFolder: false })).toEqual([]);
  });

  it("lists both sweeps, issue first, under stable ids", () => {
    const items = sweepItems();

    expect(items.map((item) => item.id)).toEqual([
      "cmd:delete-issue-sidecars",
      "cmd:delete-duplicate-sidecars",
    ]);
    expect(items.every((item) => item.section === "commands")).toBe(true);
  });

  it("names the suffix rather than the finding", () => {
    expect(sweepItems().map((item) => item.label)).toEqual([
      "Delete all .issue.json files",
      "Delete all .duplicate.json files",
    ]);
  });

  it("still lists a sweep the folder has nothing for, disabled", () => {
    const [issue, duplicate] = sweepItems({ counts: { issue: 0, duplicate: 2 } });

    expect(issue.disabled).toBe(true);
    expect(issue.detail).toBe("Nothing to delete");
    expect(duplicate.disabled).toBe(false);
    expect(duplicate.detail).toBe("2 duplicate finding files");
  });

  it("counts each kind on its own line", () => {
    const [issue, duplicate] = sweepItems({ counts: { issue: 1, duplicate: 4 } });

    expect(issue.detail).toBe("1 caption issue file");
    expect(duplicate.detail).toBe("4 duplicate finding files");
  });

  it("disables both while a sweep is already running", () => {
    expect(sweepItems({ busy: true }).every((item) => item.disabled)).toBe(true);
  });

  it("sweeps its own kind", () => {
    const onSweep = vi.fn();
    const [issue, duplicate] = sweepItems({ onSweep });

    issue.run();
    expect(onSweep).toHaveBeenLastCalledWith("issue");

    duplicate.run();
    expect(onSweep).toHaveBeenLastCalledWith("duplicate");
  });

  it("gives the two different icons, so neither reads as the other", () => {
    const [issue, duplicate] = sweepItems();

    expect(issue.icon).not.toBe(duplicate.icon);
  });
});
