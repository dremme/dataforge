import { describe, expect, it, vi } from "vitest";
import { iconFolder } from "@/shared/icons";
import type { QuickActionItem, QuickActionSection } from "../types";
import { MAX_RECENT_ACTIONS } from "./quickActionHistory";
import {
  MAX_RESULT_ROWS,
  flattenGroups,
  orderQuickActionItems,
  rankQuickActionItems,
  recentActionsGroup,
  resolveRecentActions,
} from "./quickActionResults";

function sections(overrides: Partial<Record<QuickActionSection, QuickActionItem[]>> = {}) {
  return {
    run: [],
    commands: [],
    subfolders: [],
    recentFolders: [],
    favorites: [],
    jobs: [],
    ...overrides,
  };
}

function item(
  id: string,
  label: string,
  overrides: Partial<QuickActionItem> = {},
): QuickActionItem {
  return {
    id,
    section: "commands" as QuickActionSection,
    label,
    icon: iconFolder,
    run: vi.fn(),
    ...overrides,
  };
}

describe("rankQuickActionItems", () => {
  it("returns nothing for a blank query, leaving the recent list to the caller", () => {
    expect(rankQuickActionItems([item("a", "Watermark")], "   ")).toEqual([]);
  });

  it("orders label prefix over word start over substring over detail-only", () => {
    const items = [
      item("detail", "Zebra", { detail: "adds a watermark" }),
      item("substring", "Rewatermarked"),
      item("word", "Add watermark"),
      item("prefix", "Watermark"),
    ];

    const [group] = rankQuickActionItems(items, "water");

    expect(group.items.map((entry) => entry.id)).toEqual(["prefix", "word", "substring", "detail"]);
  });

  it("matches hidden keywords", () => {
    const items = [item("lora", "Quick LoRA training", { keywords: "train_lora" })];

    expect(flattenGroups(rankQuickActionItems(items, "train_lora"))).toHaveLength(1);
  });

  it("splits label words on path separators, so a path segment matches", () => {
    const items = [item("folder", "C:\\Data\\shots-2026", { section: "subfolders" })];

    expect(flattenGroups(rankQuickActionItems(items, "shots"))).toHaveLength(1);
  });

  it("drops items that match nothing", () => {
    expect(rankQuickActionItems([item("a", "Watermark")], "zzz")).toEqual([]);
  });

  it("falls back to the declared section order when sections match equally well", () => {
    const items = [
      item("cmd", "alpha", { section: "commands" }),
      item("run", "alpha", { section: "run" }),
      item("sub", "alpha", { section: "subfolders" }),
    ];

    expect(rankQuickActionItems(items, "alpha").map((group) => group.id)).toEqual([
      "run",
      "commands",
      "subfolders",
    ]);
  });

  it("floats the section holding the better match above an earlier-declared one", () => {
    // The real case: both are prefix matches for "watermark", but only the job is
    // an exact one — and folders are declared first, so a tie would bury it.
    const items = [
      item("folder:watermarked", "watermarked", { section: "subfolders" }),
      item("run:watermark", "Watermark", { section: "run" }),
    ];

    const groups = rankQuickActionItems(items, "watermark");

    expect(groups.map((group) => group.id)).toEqual(["run", "subfolders"]);
    expect(flattenGroups(groups)[0].id).toBe("run:watermark");
  });

  it("puts an exact label match above a longer name that merely starts with the query", () => {
    const items = [
      item("longer", "Watermarked files", { section: "run" }),
      item("exact", "Watermark", { section: "run" }),
    ];

    const [group] = rankQuickActionItems(items, "WATERMARK");
    expect(group.items.map((entry) => entry.id)).toEqual(["exact", "longer"]);
  });

  it(`caps the whole list at ${MAX_RESULT_ROWS} rows, not each section`, () => {
    // Spread across two sections: a per-section cap would let this through at
    // double the limit, which is what made the panel scroll.
    const items = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, index) =>
      item(`sub-${index}`, `alpha ${index}`, { section: "subfolders" }),
    ).concat(
      Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, index) =>
        item(`cmd-${index}`, `alpha ${index}`, { section: "commands" }),
      ),
    );

    const groups = rankQuickActionItems(items, "alpha");
    expect(flattenGroups(groups)).toHaveLength(MAX_RESULT_ROWS);
  });

  it("spends the cap on the best matches, wherever they sit", () => {
    // Eight weak matches in an early section must not crowd out the exact one.
    const filler = Array.from({ length: MAX_RESULT_ROWS }, (_, index) =>
      item(`sub-${index}`, `shots ${index} watermarking`, { section: "subfolders" }),
    );
    const exact = item("run:watermark", "Watermark", { section: "run" });

    const rows = flattenGroups(rankQuickActionItems([...filler, exact], "watermark"));

    expect(rows).toHaveLength(MAX_RESULT_ROWS);
    expect(rows[0].id).toBe("run:watermark");
  });

  it("is case-insensitive", () => {
    expect(flattenGroups(rankQuickActionItems([item("a", "Watermark")], "WATER"))).toHaveLength(1);
  });
});

describe("resolveRecentActions", () => {
  const never = () => null;

  it("resolves ids against live items, most recent first", () => {
    const watermark = item("run:watermark", "Watermark");
    const rename = item("run:batch_rename", "Rename");

    const resolved = resolveRecentActions(
      ["run:batch_rename", "run:watermark"],
      [watermark, rename],
      never,
      [],
    );

    expect(resolved.map((entry) => entry.id)).toEqual(["run:batch_rename", "run:watermark"]);
  });

  it("skips an id nothing can resolve", () => {
    const watermark = item("run:watermark", "Watermark");

    const resolved = resolveRecentActions(
      ["job:deleted-job", "run:watermark"],
      [watermark],
      never,
      [],
    );

    expect(resolved.map((entry) => entry.id)).toEqual(["run:watermark"]);
  });

  it("synthesizes a folder that has dropped out of every live list", () => {
    const synthesized = item("folder:C:\\Old", "Old", { section: "recentFolders" });

    const resolved = resolveRecentActions(
      ["folder:C:\\Old"],
      [],
      (id) => (id === "folder:C:\\Old" ? synthesized : null),
      [],
    );

    expect(resolved).toEqual([synthesized]);
  });

  it("tops up a short history without repeating an already-listed row", () => {
    const watermark = item("run:watermark", "Watermark");
    const shots = item("folder:C:\\Shots", "Shots", { section: "subfolders" });
    const takes = item("folder:C:\\Takes", "Takes", { section: "subfolders" });

    const resolved = resolveRecentActions(["run:watermark"], [watermark, shots, takes], never, [
      watermark,
      shots,
      takes,
    ]);

    expect(resolved.map((entry) => entry.id)).toEqual([
      "run:watermark",
      "folder:C:\\Shots",
      "folder:C:\\Takes",
    ]);
  });

  it(`caps the list at ${MAX_RECENT_ACTIONS} even when the top-up is long`, () => {
    const topUp = Array.from({ length: MAX_RECENT_ACTIONS + 6 }, (_, index) =>
      item(`folder:C:\\F${index}`, `F${index}`, { section: "subfolders" }),
    );

    expect(resolveRecentActions([], [], never, topUp)).toHaveLength(MAX_RECENT_ACTIONS);
  });

  it("shows the recent list at the same ceiling a search result gets", () => {
    expect(MAX_RECENT_ACTIONS).toBe(MAX_RESULT_ROWS);
  });

  it("matches ids case-insensitively", () => {
    const shots = item("folder:C:\\Shots", "Shots", { section: "subfolders" });

    const resolved = resolveRecentActions(["folder:c:\\shots"], [shots], never, []);
    expect(resolved).toEqual([shots]);
  });
});

describe("orderQuickActionItems", () => {
  it("emits sections in their declared order, not the order they were passed", () => {
    const ordered = orderQuickActionItems(
      sections({
        jobs: [item("job:1", "A job", { section: "jobs" })],
        run: [item("run:watermark", "Watermark", { section: "run" })],
        subfolders: [item("folder:C:\\Shots", "Shots", { section: "subfolders" })],
      }),
    );

    expect(ordered.map((entry) => entry.id)).toEqual([
      "run:watermark",
      "folder:C:\\Shots",
      "job:1",
    ]);
  });

  it("drops a folder that is both a subfolder and a recent, keeping the earlier section", () => {
    // Same path, so both builders mint the same id — and a duplicate id pins the
    // palette's active row, because it tracks the selection by id.
    const asSubfolder = item("folder:C:\\Shots", "Shots", { section: "subfolders" });
    const asRecent = item("folder:C:\\Shots", "Shots", { section: "recentFolders" });

    const ordered = orderQuickActionItems(
      sections({ subfolders: [asSubfolder], recentFolders: [asRecent] }),
    );

    expect(ordered).toEqual([asSubfolder]);
  });

  it("folds case when deduping, so path casing cannot smuggle a duplicate through", () => {
    const ordered = orderQuickActionItems(
      sections({
        subfolders: [item("folder:C:\\Shots", "Shots", { section: "subfolders" })],
        recentFolders: [item("folder:c:\\shots", "shots", { section: "recentFolders" })],
      }),
    );

    expect(ordered).toHaveLength(1);
  });

  it("leaves distinct folders that merely share a name alone", () => {
    const ordered = orderQuickActionItems(
      sections({
        subfolders: [item("folder:C:\\A\\out", "out", { section: "subfolders" })],
        recentFolders: [item("folder:C:\\B\\out", "out", { section: "recentFolders" })],
      }),
    );

    expect(ordered).toHaveLength(2);
  });
});

describe("recentActionsGroup", () => {
  it("emits nothing when there is nothing to show", () => {
    expect(recentActionsGroup([])).toEqual([]);
  });

  it("wraps the rows in a single Recent group", () => {
    const groups = recentActionsGroup([item("a", "Watermark")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Recent");
  });
});
