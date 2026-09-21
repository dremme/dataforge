import { describe, expect, it, vi } from "vitest";
import { folderLeafName } from "@/features/folder/lib/folderPath";
import { iconFilter, iconFilterX } from "@/shared/icons";
import type { ExternalOstrisJob, Job } from "@/shared/types";
import type { QuickActionItem, QuickActionSection } from "../types";
import {
  buildFilterItems,
  buildJobItems,
  buildSelectionCommandItems,
  buildSidecarSweepItems,
  buildSubfolderItems,
  quickActionFolderId,
  type FilterCommandOptions,
  type SelectionCommandOptions,
  type SidecarSweepOptions,
} from "./buildQuickActionItems";
import { flattenGroups, orderQuickActionItems, rankQuickActionItems } from "./quickActionResults";

function sections(overrides: Partial<Record<QuickActionSection, QuickActionItem[]>> = {}) {
  return {
    run: [],
    commands: [],
    filters: [],
    subfolders: [],
    recentFolders: [],
    favorites: [],
    jobs: [],
    ...overrides,
  };
}

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

function filterItems(overrides: Partial<FilterCommandOptions> = {}) {
  return buildFilterItems({
    hasFolder: true,
    hasActiveFilters: false,
    mediaType: "all",
    caption: "all",
    file: "all",
    counts: {
      mediaType: { all: 9, image: 6, video: 3 },
      caption: { all: 9, captioned: 5, issue: 1, uncaptioned: 4 },
      file: { all: 9, edited: 2, duplicates: 0, candidates: 1 },
    },
    onSelectMediaType: vi.fn(),
    onSelectCaption: vi.fn(),
    onSelectFile: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  });
}

describe("buildFilterItems", () => {
  it("offers nothing without a folder", () => {
    expect(filterItems({ hasFolder: false })).toEqual([]);
  });

  it("covers every menu option except each axis's All, then the reset", () => {
    expect(filterItems().map((item) => item.id)).toEqual([
      "filter:mediaType:image",
      "filter:mediaType:video",
      "filter:caption:captioned",
      "filter:caption:issue",
      "filter:caption:uncaptioned",
      "filter:file:edited",
      "filter:file:duplicates",
      "filter:file:candidates",
      "filter:reset",
    ]);
  });

  it("labels rows so they read without the menu's group heading", () => {
    const labels = new Map(filterItems().map((item) => [item.id, item.label]));

    expect(labels.get("filter:mediaType:video")).toBe("Videos and GIFs");
    expect(labels.get("filter:caption:uncaptioned")).toBe("Missing caption");
    expect(labels.get("filter:file:candidates")).toBe("ComfyUI candidates");
  });

  it("marks every row as a filter action, whatever the axis or subject", () => {
    const rows = filterItems();
    const [reset] = rows.slice(-1);

    expect(rows.slice(0, -1).every((item) => item.icon === iconFilter)).toBe(true);
    // The reset is the same glyph struck through, so the section still reads as one family.
    expect(reset.icon).toBe(iconFilterX);
  });

  it("names the axis and what picking the row would leave", () => {
    const details = new Map(filterItems().map((item) => [item.id, item.detail]));

    expect(details.get("filter:mediaType:image")).toBe("Media type · 6 files");
    expect(details.get("filter:caption:issue")).toBe("Caption status · 1 file");
    expect(details.get("filter:file:duplicates")).toBe("Files · 0 files");
  });

  it("keeps a zero-count filter runnable, since the empty state explains itself", () => {
    const duplicates = filterItems().find((item) => item.id === "filter:file:duplicates");

    expect(duplicates?.disabled).toBe(false);
  });

  it("marks the filter already in force as inert rather than letting it no-op", () => {
    const items = filterItems({ mediaType: "video", hasActiveFilters: true });
    const active = items.find((item) => item.id === "filter:mediaType:video");
    const other = items.find((item) => item.id === "filter:mediaType:image");

    expect(active?.disabled).toBe(true);
    expect(active?.detail).toBe("Media type · already active");
    expect(other?.disabled).toBe(false);
  });

  it("finds a row by the terse label the menu shows", () => {
    const missing = filterItems().find((item) => item.id === "filter:caption:uncaptioned");

    expect(missing?.keywords).toContain("Missing");
    expect(missing?.keywords).toContain("filter");
  });

  it("sets only its own axis", () => {
    const onSelectMediaType = vi.fn();
    const onSelectCaption = vi.fn();
    const onSelectFile = vi.fn();
    const items = filterItems({ onSelectMediaType, onSelectCaption, onSelectFile });

    items.find((item) => item.id === "filter:mediaType:video")?.run();
    items.find((item) => item.id === "filter:file:edited")?.run();

    expect(onSelectMediaType).toHaveBeenCalledWith("video");
    expect(onSelectFile).toHaveBeenCalledWith("edited");
    expect(onSelectCaption).not.toHaveBeenCalled();
  });

  it("offers the reset only once something is filtered", () => {
    const idle = filterItems().at(-1);
    expect(idle?.disabled).toBe(true);
    expect(idle?.detail).toBe("No filters active");

    const onReset = vi.fn();
    const active = filterItems({ hasActiveFilters: true, onReset }).at(-1);
    expect(active?.disabled).toBe(false);
    expect(active?.detail).toBe("Back to all media, captions and files");

    active?.run();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function job(id: string, folder: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    folder,
    folder_name: folderLeafName(folder),
    job_type: "auto_caption",
    status: "completed",
    effective_status: "completed",
    total: 3,
    processed: 3,
    stats: { total: 3, success: 3 },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function externalJob(id: string, folder: string): ExternalOstrisJob {
  return {
    id,
    name: `run-${id}`,
    status: "running",
    step: 100,
    dataset_folder: folder,
    dataset_folder_name: folderLeafName(folder),
    save_now: false,
    stop_requested: false,
  };
}

describe("buildJobItems", () => {
  const folder = "C:\\Data\\gts_dataset";

  it("shares the folder's id so a history of runs collapses to its newest", () => {
    const items = buildJobItems(
      [job("j1", folder, { job_type: "watermark" }), job("j2", folder)],
      [],
      vi.fn(),
    );

    expect(items.map((item) => item.id)).toEqual([
      quickActionFolderId(folder),
      quickActionFolderId(folder),
    ]);
    expect(orderQuickActionItems(sections({ jobs: items }))).toHaveLength(1);
  });

  it("keeps the newest run's outcome on the row that survives", () => {
    const items = buildJobItems([job("j1", folder), job("j2", folder)], [], vi.fn());
    const [surviving] = orderQuickActionItems(sections({ jobs: items }));

    expect(surviving.label).toBe("gts_dataset");
    expect(surviving.detail).toBe("Auto-caption · Completed");
  });

  it("yields to a plainer row for the same folder", () => {
    const onNavigate = vi.fn();
    const subfolders = buildSubfolderItems([{ name: "gts_dataset", path: folder }], onNavigate);
    const jobs = buildJobItems([job("j1", folder)], [], onNavigate);

    const ordered = orderQuickActionItems(sections({ subfolders, jobs }));

    expect(ordered).toHaveLength(1);
    expect(ordered[0].section).toBe("subfolders");
  });

  it("lets a live training run stand for the folder over a finished local job", () => {
    const items = buildJobItems([job("j1", folder)], [externalJob("ostris-1", folder)], vi.fn());
    const [surviving] = orderQuickActionItems(sections({ jobs: items }));

    expect(surviving.detail).toBe("LoRA training · running");
  });

  it("matches its folder name, and nothing the row does not show", () => {
    const nested = "C:\\Data\\ml\\gts_dataset";
    const items = buildJobItems([job("j1", nested)], [externalJob("ostris-1", nested)], vi.fn());
    const rows = orderQuickActionItems(sections({ jobs: items }));

    expect(items.every((item) => item.keywords === undefined)).toBe(true);
    // "ml" and the ostris run name sit in the path and the job record, never on the row.
    expect(rankQuickActionItems(rows, "ml")).toEqual([]);
    expect(rankQuickActionItems(rows, "run-ostris-1")).toEqual([]);
    expect(flattenGroups(rankQuickActionItems(rows, "gts"))).toHaveLength(1);
  });

  it("navigates to the job's folder", () => {
    const onNavigate = vi.fn();
    buildJobItems([job("j1", folder)], [], onNavigate)[0].run();

    expect(onNavigate).toHaveBeenCalledWith(folder);
  });
});
