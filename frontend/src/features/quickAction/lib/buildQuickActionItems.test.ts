import { describe, expect, it, vi } from "vitest";
import {
  buildSelectionCommandItems,
  buildSidecarSweepItems,
  type SelectionCommandOptions,
  type SidecarSweepOptions,
} from "./buildQuickActionItems";

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

function selectionItems(overrides: Partial<SelectionCommandOptions> = {}) {
  return buildSelectionCommandItems({
    hasFolder: true,
    selectionMode: false,
    selectedCount: 0,
    visibleCount: 3,
    busy: false,
    onSelectAll: vi.fn(),
    onInvertSelection: vi.fn(),
    onMove: vi.fn(),
    onCopy: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  });
}

describe("buildSelectionCommandItems", () => {
  it("offers nothing without a folder", () => {
    expect(selectionItems({ hasFolder: false })).toEqual([]);
  });

  it("lists select all, invert, and the batch actions under stable ids", () => {
    expect(selectionItems().map((item) => item.id)).toEqual([
      "cmd:select-all",
      "cmd:invert-selection",
      "cmd:move-selected",
      "cmd:copy-selected",
      "cmd:delete-selected",
    ]);
  });

  it("keeps select all enabled outside selection mode, and disables invert and the batch actions", () => {
    const [selectAll, invert, move, copy, remove] = selectionItems();

    expect(selectAll.disabled).toBe(false);
    expect(invert.disabled).toBe(true);
    expect(invert.detail).toBe("Not in selection mode");
    expect(move.disabled).toBe(true);
    expect(copy.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(move.detail).toBe("Nothing selected");
  });

  it("enables invert once selection mode is on, even with nothing selected", () => {
    const [, invert] = selectionItems({ selectionMode: true });

    expect(invert.disabled).toBe(false);
    expect(invert.detail).toBe("Swap selected and unselected in this view");
  });

  it("enables the batch actions once files are selected", () => {
    const [, , move, copy, remove] = selectionItems({
      selectionMode: true,
      selectedCount: 2,
    });

    expect(move.disabled).toBe(false);
    expect(copy.disabled).toBe(false);
    expect(remove.disabled).toBe(false);
    expect(move.detail).toBe("2 selected files");
  });

  it("disables select all once every visible file is already selected", () => {
    const [selectAll] = selectionItems({
      selectionMode: true,
      selectedCount: 3,
      visibleCount: 3,
    });

    expect(selectAll.disabled).toBe(true);
  });

  it("disables select all and invert when the view is empty", () => {
    const [selectAll, invert] = selectionItems({ selectionMode: true, visibleCount: 0 });

    expect(selectAll.disabled).toBe(true);
    expect(selectAll.detail).toBe("No files in this view");
    expect(invert.disabled).toBe(true);
    expect(invert.detail).toBe("No files in this view");
  });

  it("disables every row while a batch action is already running", () => {
    expect(
      selectionItems({ selectionMode: true, selectedCount: 2, busy: true }).every(
        (item) => item.disabled,
      ),
    ).toBe(true);
  });

  it("runs the matching handler", () => {
    const onSelectAll = vi.fn();
    const onInvertSelection = vi.fn();
    const onMove = vi.fn();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    const [selectAll, invert, move, copy, remove] = selectionItems({
      onSelectAll,
      onInvertSelection,
      onMove,
      onCopy,
      onDelete,
    });

    selectAll.run();
    invert.run();
    move.run();
    copy.run();
    remove.run();

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onInvertSelection).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
