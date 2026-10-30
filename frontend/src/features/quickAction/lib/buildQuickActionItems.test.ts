import { describe, expect, it, vi } from "vitest";
import { folderLeafName } from "@/features/folder/lib/folderPath";
import {
  iconFilter,
  iconFilterX,
  iconPencilLine,
  iconScanSquare,
  iconTrash2,
} from "@/shared/icons";
import type { ExternalOstrisJob, Job, SidecarKind } from "@/shared/types";
import type { QuickActionItem, QuickActionSection } from "../types";
import {
  buildSettleAllCandidatesItems,
  buildAppCommandItems,
  buildCommandItems,
  buildFilterItems,
  buildFolderCommandItems,
  buildFolderPathCommandItems,
  buildNavigationCommandItems,
  buildReviewCommandItems,
  buildSyspromptCommandItem,
  buildJobItems,
  buildSelectionCommandItems,
  buildSidecarSweepItems,
  buildSubfolderItems,
  quickActionFolderId,
  type SettleAllCandidatesOptions,
  type CommandOptions,
  type FilterCommandOptions,
  type SelectionCommandOptions,
  type SidecarSweepOptions,
} from "./buildQuickActionItems";
import { flattenGroups, orderQuickActionItems, rankQuickActionItems } from "./quickActionResults";
import type { ResolvedTheme } from "@/shared/theme/theme";
import type { FileFilter, ItemFilter, MediaTypeFilter } from "@/features/gallery/lib/query";

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

function idsFor(items: QuickActionItem[], query: string) {
  return flattenGroups(rankQuickActionItems(items, query)).map((item) => item.id);
}

function navigationItems(
  overrides: Partial<Parameters<typeof buildNavigationCommandItems>[0]> = {},
) {
  return buildNavigationCommandItems({
    parentPath: "C:\\Photos",
    atHome: false,
    onGoHome: vi.fn<() => void>(),
    onNavigate: vi.fn<(path: string) => void>(),
    ...overrides,
  });
}

describe("buildNavigationCommandItems", () => {
  it("lists home and parent under stable ids", () => {
    expect(navigationItems().map((item) => item.id)).toEqual([
      "cmd:home-folder",
      "cmd:parent-folder",
    ]);
  });

  it("disables home at home and parent at a root", () => {
    const [home, parent] = navigationItems({ atHome: true, parentPath: null });

    expect(home.disabled).toBe(true);
    expect(parent.disabled).toBe(true);
    expect(parent.detail).toBe("No parent folder");
  });

  it("navigates to the parent it names", () => {
    const onNavigate = vi.fn<(path: string) => void>();
    const [, parent] = navigationItems({ onNavigate });

    parent.run();

    expect(parent.detail).toBe("C:\\Photos");
    expect(onNavigate).toHaveBeenCalledWith("C:\\Photos");
  });

  it.each([
    ["go home", "cmd:home-folder"],
    ["up", "cmd:parent-folder"],
  ])("finds %s as %s", (query, id) => {
    expect(idsFor(navigationItems(), query)).toEqual([id]);
  });
});

describe("buildFolderCommandItems", () => {
  it("offers only refresh for a folder that has gone missing", () => {
    const items = buildFolderCommandItems({
      folderFound: false,
      isFavorite: false,
      onCreateFolder: vi.fn<() => void>(),
      onToggleFavorite: vi.fn<() => void>(),
      onRefresh: vi.fn<() => void>(),
    });

    expect(items.map((item) => item.id)).toEqual(["cmd:refresh-folder"]);
  });

  it.each([
    ["mkdir", "cmd:new-folder"],
    ["bookmark", "cmd:favorite-folder"],
    ["reload", "cmd:refresh-folder"],
  ])("finds %s as %s", (query, id) => {
    const items = buildFolderCommandItems({
      folderFound: true,
      isFavorite: false,
      onCreateFolder: vi.fn<() => void>(),
      onToggleFavorite: vi.fn<() => void>(),
      onRefresh: vi.fn<() => void>(),
    });

    expect(idsFor(items, query)).toEqual([id]);
  });

  it.each([
    [false, "cmd:favorite-folder", "Favorite folder"],
    [true, "cmd:unfavorite-folder", "Unfavorite folder"],
  ])("offers the favorite toggle that applies when favorite is %s", (isFavorite, id, label) => {
    const onToggleFavorite = vi.fn<() => void>();
    const toggle = buildFolderCommandItems({
      folderFound: true,
      isFavorite,
      onCreateFolder: vi.fn<() => void>(),
      onToggleFavorite,
      onRefresh: vi.fn<() => void>(),
    }).find((item) => item.id === id);

    toggle?.run();

    expect(toggle?.label).toBe(label);
    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });

  it("offers deleting the folder only while a delete handler is set", () => {
    const options = {
      folderFound: true,
      isFavorite: false,
      onCreateFolder: vi.fn<() => void>(),
      onToggleFavorite: vi.fn<() => void>(),
      onRefresh: vi.fn<() => void>(),
    };
    const onDeleteFolder = vi.fn<() => void>();

    expect(buildFolderCommandItems(options).map((item) => item.id)).not.toContain(
      "cmd:delete-folder",
    );

    const items = buildFolderCommandItems({ ...options, onDeleteFolder });
    expect(idsFor(items, "rmdir")).toEqual(["cmd:delete-folder"]);
    const row = items.find((item) => item.id === "cmd:delete-folder");
    expect(row?.icon).toBe(iconTrash2);
    row?.run();
    expect(onDeleteFolder).toHaveBeenCalledOnce();
  });

  it("offers renaming the folder only while a rename handler is set", () => {
    const options = {
      folderFound: true,
      isFavorite: false,
      onCreateFolder: vi.fn<() => void>(),
      onToggleFavorite: vi.fn<() => void>(),
      onRefresh: vi.fn<() => void>(),
    };
    const onRenameFolder = vi.fn<() => void>();

    expect(buildFolderCommandItems(options).map((item) => item.id)).not.toContain(
      "cmd:rename-folder",
    );

    const items = buildFolderCommandItems({ ...options, onRenameFolder });
    expect(idsFor(items, "relabel")).toEqual(["cmd:rename-folder"]);
    const row = items.find((item) => item.id === "cmd:rename-folder");
    expect(row?.icon).toBe(iconPencilLine);
    row?.run();
    expect(onRenameFolder).toHaveBeenCalledOnce();
  });
});

describe("buildReviewCommandItems", () => {
  const counts = { issueCount: 2, duplicateGroupCount: 1, candidateCount: 3 };

  it("offers only the reviews that have work", () => {
    expect(buildReviewCommandItems(counts)).toEqual([]);

    const items = buildReviewCommandItems({ ...counts, onReviewCandidates: vi.fn<() => void>() });
    expect(items.map((item) => item.id)).toEqual(["cmd:review-candidates"]);
  });

  it("counts what each review has waiting", () => {
    const items = buildReviewCommandItems({
      ...counts,
      onResolveIssues: vi.fn<() => void>(),
      onResolveDuplicates: vi.fn<() => void>(),
      onReviewCandidates: vi.fn<() => void>(),
    });

    expect(items.map((item) => item.detail)).toEqual(["2 flagged", "1 group", "3 waiting"]);
  });

  it.each([
    ["warnings", "cmd:resolve-issues"],
    ["dedupe", "cmd:resolve-duplicates"],
    ["side by side", "cmd:review-candidates"],
  ])("finds %s as %s", (query, id) => {
    const items = buildReviewCommandItems({
      ...counts,
      onResolveIssues: vi.fn<() => void>(),
      onResolveDuplicates: vi.fn<() => void>(),
      onReviewCandidates: vi.fn<() => void>(),
    });

    expect(idsFor(items, query)).toEqual([id]);
  });
});

describe("buildFolderPathCommandItems", () => {
  it("copies and reveals the folder it shows", () => {
    const onCopyPath = vi.fn<(path: string) => void>();
    const onRevealInExplorer = vi.fn<(path: string) => void>();
    const [copy, reveal] = buildFolderPathCommandItems({
      folderPath: "C:\\Photos",
      onCopyPath,
      onRevealInExplorer,
    });

    copy.run();
    reveal.run();

    expect(onCopyPath).toHaveBeenCalledWith("C:\\Photos");
    expect(onRevealInExplorer).toHaveBeenCalledWith("C:\\Photos");
  });
});

describe("buildAppCommandItems", () => {
  const appItems = (onSetTheme = vi.fn<(theme: ResolvedTheme) => void>()) =>
    buildAppCommandItems({
      theme: "dark",
      onOpenSettings: vi.fn<() => void>(),
      onOpenShortcuts: vi.fn<() => void>(),
      onSetTheme,
    });

  it.each([
    ["preferences", "cmd:settings"],
    ["port", "cmd:settings"],
    ["thumbnail cache", "cmd:settings"],
    ["night mode", "cmd:toggle-theme"],
    ["hotkeys", "cmd:keyboard-shortcuts"],
  ])("finds %j", (query, id) => {
    expect(idsFor(appItems(), query)).toEqual([id]);
  });

  it("offers the scheme that is not on screen", () => {
    const onSetTheme = vi.fn<(theme: ResolvedTheme) => void>();
    const toggle = appItems(onSetTheme).find((item) => item.id === "cmd:toggle-theme");

    toggle?.run();

    expect(toggle?.label).toBe("Switch to light theme");
    expect(onSetTheme).toHaveBeenCalledWith("light");
  });
});

describe("buildSyspromptCommandItem", () => {
  it("is found by what the prompt is for", () => {
    expect(idsFor([buildSyspromptCommandItem(vi.fn())], "guidelines")).toEqual([
      "cmd:edit-sysprompt",
    ]);
  });
});

function commandItems(overrides: Partial<CommandOptions> = {}) {
  return buildCommandItems({
    folder: { path: "C:\\Photos\\Lakes", home: "C:\\Photos", parent: "C:\\Photos" },
    folderFound: true,
    onGoHome: vi.fn<() => void>(),
    onNavigate: vi.fn<(path: string) => void>(),
    isFavorite: false,
    onCreateFolder: vi.fn<() => void>(),
    onToggleFavorite: vi.fn<() => void>(),
    onRefresh: vi.fn<() => void>(),
    onCopyPath: vi.fn<(path: string) => void>(),
    onRevealInExplorer: vi.fn<(path: string) => void>(),
    onEditSysprompt: vi.fn<() => void>(),
    review: {
      issueCount: 1,
      onResolveIssues: vi.fn<() => void>(),
      duplicateGroupCount: 0,
      candidateCount: 0,
    },
    settleAllCandidates: {
      count: 2,
      fromSelection: false,
      busy: false,
      onAccept: vi.fn<() => void>(),
      onDelete: vi.fn<() => void>(),
    },
    sidecarSweep: {
      counts: { issue: 1, duplicate: 0, empty_caption: 0 },
      busy: false,
      onSweep: vi.fn<(kind: SidecarKind) => void>(),
    },
    selection: {
      selectionMode: false,
      selectedCount: 0,
      visibleCount: 3,
      busy: false,
      onSelectAll: vi.fn<() => void>(),
      onInvertSelection: vi.fn<() => void>(),
      onMove: vi.fn<() => void>(),
      onCopy: vi.fn<() => void>(),
      onDelete: vi.fn<() => void>(),
    },
    app: {
      theme: "dark",
      onOpenSettings: vi.fn<() => void>(),
      onOpenShortcuts: vi.fn<() => void>(),
      onSetTheme: vi.fn<(theme: ResolvedTheme) => void>(),
    },
    ...overrides,
  });
}

describe("buildCommandItems", () => {
  it("lists every command in palette order", () => {
    expect(commandItems().map((item) => item.id)).toEqual([
      "cmd:home-folder",
      "cmd:parent-folder",
      "cmd:new-folder",
      "cmd:favorite-folder",
      "cmd:refresh-folder",
      "cmd:resolve-issues",
      "cmd:accept-all-candidates",
      "cmd:delete-all-candidates",
      "cmd:delete-issue-sidecars",
      "cmd:delete-duplicate-sidecars",
      "cmd:delete-empty_caption-sidecars",
      "cmd:select-all",
      "cmd:invert-selection",
      "cmd:move-selected",
      "cmd:copy-selected",
      "cmd:delete-selected",
      "cmd:edit-sysprompt",
      "cmd:copy-path",
      "cmd:open-in-explorer",
      "cmd:settings",
      "cmd:toggle-theme",
      "cmd:keyboard-shortcuts",
    ]);
  });

  it("offers navigation and app commands before a folder is open", () => {
    expect(commandItems({ folder: null }).map((item) => item.id)).toEqual([
      "cmd:home-folder",
      "cmd:parent-folder",
      "cmd:settings",
      "cmd:toggle-theme",
      "cmd:keyboard-shortcuts",
    ]);
  });

  it("keeps only what still works for a folder that has gone missing", () => {
    expect(commandItems({ folderFound: false }).map((item) => item.id)).toEqual([
      "cmd:home-folder",
      "cmd:parent-folder",
      "cmd:refresh-folder",
      "cmd:resolve-issues",
      "cmd:edit-sysprompt",
      "cmd:settings",
      "cmd:toggle-theme",
      "cmd:keyboard-shortcuts",
    ]);
  });

  it("disables home only while at home", () => {
    const home = (options: Partial<CommandOptions>) =>
      commandItems(options).find((item) => item.id === "cmd:home-folder");

    expect(home({})?.disabled).toBe(false);
    expect(
      home({ folder: { path: "C:\\Photos", home: "C:\\Photos", parent: null } })?.disabled,
    ).toBe(true);
    expect(
      home({
        folder: { path: "C:\\Photos", home: "C:\\Photos", parent: null },
        folderFound: false,
      })?.disabled,
    ).toBe(false);
  });
});

function sweepItems(overrides: Partial<SidecarSweepOptions> = {}) {
  return buildSidecarSweepItems({
    hasFolder: true,
    counts: { issue: 3, duplicate: 2, empty_caption: 5 },
    busy: false,
    onSweep: vi.fn<(kind: SidecarKind) => void>(),
    ...overrides,
  });
}

describe("buildSidecarSweepItems", () => {
  it("offers nothing without a folder", () => {
    expect(sweepItems({ hasFolder: false })).toEqual([]);
  });

  it.each(["cleanup", "purge", "sidecar"])("finds every sweep by %s", (query) => {
    expect(flattenGroups(rankQuickActionItems(sweepItems(), query)).map((item) => item.id)).toEqual(
      [
        "cmd:delete-issue-sidecars",
        "cmd:delete-duplicate-sidecars",
        "cmd:delete-empty_caption-sidecars",
      ],
    );
  });

  it.each([
    ["warnings", "cmd:delete-issue-sidecars"],
    ["dedupe", "cmd:delete-duplicate-sidecars"],
    ["blank", "cmd:delete-empty_caption-sidecars"],
  ])("tells the sweeps apart by %s", (query, id) => {
    expect(flattenGroups(rankQuickActionItems(sweepItems(), query)).map((item) => item.id)).toEqual(
      [id],
    );
  });

  it("lists every sweep, issue first, under stable ids", () => {
    const items = sweepItems();

    expect(items.map((item) => item.id)).toEqual([
      "cmd:delete-issue-sidecars",
      "cmd:delete-duplicate-sidecars",
      "cmd:delete-empty_caption-sidecars",
    ]);
    expect(items.every((item) => item.section === "commands")).toBe(true);
  });

  it("names the suffix rather than the finding", () => {
    expect(sweepItems().map((item) => item.label)).toEqual([
      "Delete all .issue.json files",
      "Delete all .duplicate.json files",
      "Delete empty caption files",
    ]);
  });

  it("still lists a sweep the folder has nothing for, disabled", () => {
    const [issue, duplicate] = sweepItems({
      counts: { issue: 0, duplicate: 2, empty_caption: 0 },
    });

    expect(issue.disabled).toBe(true);
    expect(issue.detail).toBe("Nothing to delete");
    expect(duplicate.disabled).toBe(false);
    expect(duplicate.detail).toBe("2 duplicate finding files");
  });

  it("counts each kind on its own line", () => {
    const [issue, duplicate, emptyCaption] = sweepItems({
      counts: { issue: 1, duplicate: 4, empty_caption: 1 },
    });

    expect(issue.detail).toBe("1 caption issue file");
    expect(duplicate.detail).toBe("4 duplicate finding files");
    expect(emptyCaption.detail).toBe("1 empty caption file");
  });

  it("disables both while a sweep is already running", () => {
    expect(sweepItems({ busy: true }).every((item) => item.disabled)).toBe(true);
  });

  it("sweeps its own kind", () => {
    const onSweep = vi.fn<(kind: SidecarKind) => void>();
    const [issue, duplicate, emptyCaption] = sweepItems({ onSweep });

    issue.run();
    expect(onSweep).toHaveBeenLastCalledWith("issue");

    duplicate.run();
    expect(onSweep).toHaveBeenLastCalledWith("duplicate");

    emptyCaption.run();
    expect(onSweep).toHaveBeenLastCalledWith("empty_caption");
  });

  it("wears the trash icon on every sweep, since each deletes files", () => {
    expect(sweepItems().every((item) => item.icon === iconTrash2)).toBe(true);
  });
});

function settleAllItems(overrides: Partial<SettleAllCandidatesOptions> = {}) {
  return buildSettleAllCandidatesItems({
    hasFolder: true,
    count: 4,
    fromSelection: false,
    busy: false,
    onAccept: vi.fn<() => void>(),
    onDelete: vi.fn<() => void>(),
    ...overrides,
  });
}

describe("buildSettleAllCandidatesItems", () => {
  it("offers nothing without a folder", () => {
    expect(settleAllItems({ hasFolder: false })).toEqual([]);
  });

  it("offers accept and delete under stable ids, counting what is waiting", () => {
    const [accept, remove] = settleAllItems();

    expect(accept).toMatchObject({
      id: "cmd:accept-all-candidates",
      section: "commands",
      label: "Accept all staged candidates",
      detail: "4 candidates waiting",
      disabled: false,
    });
    expect(remove).toMatchObject({
      id: "cmd:delete-all-candidates",
      section: "commands",
      label: "Delete all staged candidates",
      detail: "4 candidates waiting",
      disabled: false,
    });
  });

  it("wears the candidate icon to accept and the trash icon to delete", () => {
    const [accept, remove] = settleAllItems();

    expect(accept.icon).toBe(iconScanSquare);
    expect(remove.icon).toBe(iconTrash2);
  });

  it("narrows to the selection when files are selected", () => {
    const [accept, remove] = settleAllItems({ count: 1, fromSelection: true });

    expect(accept.label).toBe("Accept selected candidates");
    expect(remove.label).toBe("Delete selected candidates");
    expect(remove.detail).toBe("1 candidate in the selection");
  });

  it.each([
    ["no selected file has a candidate", { count: 0, fromSelection: true }],
    ["nothing is waiting", { count: 0 }],
    ["a batch is already running", { busy: true }],
  ])("is disabled when %s", (_, overrides) => {
    expect(settleAllItems(overrides).map((item) => item.disabled)).toEqual([true, true]);
  });

  it("says why when nothing can be settled", () => {
    expect(settleAllItems({ count: 0, fromSelection: true })[0].detail).toBe(
      "No candidates in the selection",
    );
    expect(settleAllItems({ count: 0 })[0].detail).toBe("No candidates waiting");
  });

  it("opens the matching confirmation instead of settling", () => {
    const onAccept = vi.fn<() => void>();
    const onDelete = vi.fn<() => void>();
    const [accept, remove] = settleAllItems({ onAccept, onDelete });

    remove.run();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();

    accept.run();
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["approve", "cmd:accept-all-candidates"],
    ["apply", "cmd:accept-all-candidates"],
    ["reject", "cmd:delete-all-candidates"],
    ["discard", "cmd:delete-all-candidates"],
    ["recycle bin", "cmd:delete-all-candidates"],
  ])("finds %j", (query, id) => {
    const ranked = rankQuickActionItems(settleAllItems(), query);

    expect(flattenGroups(ranked).map((item) => item.id)).toEqual([id]);
  });

  it.each(["comfyui", "bulk", "upscaled"])("finds both by %s", (query) => {
    const ranked = rankQuickActionItems(settleAllItems(), query);

    expect(flattenGroups(ranked).map((item) => item.id)).toEqual([
      "cmd:accept-all-candidates",
      "cmd:delete-all-candidates",
    ]);
  });
});

function selectionItems(overrides: Partial<SelectionCommandOptions> = {}) {
  return buildSelectionCommandItems({
    hasFolder: true,
    selectionMode: false,
    selectedCount: 0,
    visibleCount: 3,
    busy: false,
    onSelectAll: vi.fn<() => void>(),
    onInvertSelection: vi.fn<() => void>(),
    onMove: vi.fn<() => void>(),
    onCopy: vi.fn<() => void>(),
    onDelete: vi.fn<() => void>(),
    ...overrides,
  });
}

describe("buildSelectionCommandItems", () => {
  it.each([
    ["ctrl+a", "cmd:select-all"],
    ["reverse", "cmd:invert-selection"],
    ["cut", "cmd:move-selected"],
    ["clone", "cmd:copy-selected"],
    ["recycle", "cmd:delete-selected"],
  ])("finds %s as %s", (query, id) => {
    expect(
      flattenGroups(rankQuickActionItems(selectionItems(), query)).map((item) => item.id),
    ).toEqual([id]);
  });

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
    const onSelectAll = vi.fn<() => void>();
    const onInvertSelection = vi.fn<() => void>();
    const onMove = vi.fn<() => void>();
    const onCopy = vi.fn<() => void>();
    const onDelete = vi.fn<() => void>();
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
      mediaType: { all: 9, image: 6, video: 3, audio: 0 },
      caption: { all: 9, captioned: 5, issue: 1, uncaptioned: 4 },
      file: { all: 9, edited: 2, duplicates: 0, candidates: 1 },
    },
    onSelectMediaType: vi.fn<(value: MediaTypeFilter) => void>(),
    onSelectCaption: vi.fn<(value: ItemFilter) => void>(),
    onSelectFile: vi.fn<(value: FileFilter) => void>(),
    onReset: vi.fn<() => void>(),
    ...overrides,
  });
}

describe("buildFilterItems", () => {
  it("finds reset by unfilter", () => {
    expect(
      flattenGroups(rankQuickActionItems(filterItems({ hasActiveFilters: true }), "unfilter")).map(
        (item) => item.id,
      ),
    ).toEqual(["filter:reset"]);
  });

  it("offers nothing without a folder", () => {
    expect(filterItems({ hasFolder: false })).toEqual([]);
  });

  it("covers every menu option except each axis's All, then the reset", () => {
    expect(filterItems().map((item) => item.id)).toEqual([
      "filter:mediaType:image",
      "filter:mediaType:video",
      "filter:mediaType:audio",
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
    const onSelectMediaType = vi.fn<(value: MediaTypeFilter) => void>();
    const onSelectCaption = vi.fn<(value: ItemFilter) => void>();
    const onSelectFile = vi.fn<(value: FileFilter) => void>();
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

    const onReset = vi.fn<() => void>();
    const active = filterItems({ hasActiveFilters: true, onReset }).at(-1);
    expect(active?.disabled).toBe(false);
    expect(active?.detail).toBe("Back to all media, captions and files");

    active?.run();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

function job(id: string, folder: string, overrides: Partial<Job> = {}): Job {
  return {
    workflow_edited: false,
    undoable: false,
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
    revision: 1,
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
    const onNavigate = vi.fn<(path: string) => void>();
    const subfolders = buildSubfolderItems([{ name: "gts_dataset", path: folder }], onNavigate);
    const jobs = buildJobItems([job("j1", folder)], [], onNavigate);

    const ordered = orderQuickActionItems(sections({ subfolders, jobs }));

    expect(ordered).toHaveLength(1);
    expect(ordered[0].section).toBe("subfolders");
  });

  it("opens a live training run's dataset folder", () => {
    const onNavigate = vi.fn<(path: string) => void>();
    const [item] = buildJobItems([], [externalJob("ostris-1", folder)], onNavigate);

    item.run();

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(folder);
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
    const onNavigate = vi.fn<(path: string) => void>();
    buildJobItems([job("j1", folder)], [], onNavigate)[0].run();

    expect(onNavigate).toHaveBeenCalledWith(folder);
  });
});
