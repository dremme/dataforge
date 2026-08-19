import { describe, expect, it } from "vitest";
import {
  chooseKeeper,
  countDuplicateGroups,
  countDuplicates,
  duplicateOpenOutcome,
  isDuplicateItem,
} from "./duplicates";
import { HOME_PATH, mediaItem } from "@/test/fixtures";

function duplicate(name: string, group: string, overrides = {}) {
  return mediaItem(name, HOME_PATH, {
    has_duplicate_file: true,
    duplicate_group: group,
    ...overrides,
  });
}

describe("isDuplicateItem", () => {
  it("recognises a flagged file", () => {
    expect(isDuplicateItem(duplicate("one.png", "g1"))).toBe(true);
    expect(isDuplicateItem(mediaItem("two.png", HOME_PATH))).toBe(false);
  });

  it("never counts the sysprompt", () => {
    const sysprompt = mediaItem(".sysprompt", HOME_PATH, {
      media_type: "sysprompt",
      has_duplicate_file: true,
    });

    expect(isDuplicateItem(sysprompt)).toBe(false);
  });
});

describe("countDuplicates", () => {
  it("counts files, not groups", () => {
    const items = [
      duplicate("a.png", "g1"),
      duplicate("b.png", "g1"),
      duplicate("c.png", "g2"),
      mediaItem("d.png", HOME_PATH),
    ];

    expect(countDuplicates(items)).toBe(3);
  });
});

describe("countDuplicateGroups", () => {
  it("counts distinct groups, which is what the resolver walks", () => {
    const items = [duplicate("a.png", "g1"), duplicate("b.png", "g1"), duplicate("c.png", "g2")];

    expect(countDuplicateGroups(items)).toBe(2);
  });

  it("counts a flagged file with no group id on its own", () => {
    // The safe direction: a group is never under-reported.
    const items = [duplicate("a.png", "g1"), duplicate("b.png", "g1")];
    const orphan = mediaItem("c.png", HOME_PATH, {
      has_duplicate_file: true,
      duplicate_group: null,
    });

    expect(countDuplicateGroups([...items, orphan])).toBe(2);
  });

  it("is zero for a folder with nothing flagged", () => {
    expect(countDuplicateGroups([mediaItem("a.png", HOME_PATH)])).toBe(0);
  });
});

describe("chooseKeeper", () => {
  it("prefers the highest resolution", () => {
    const small = duplicate("small.png", "g1", { width: 512, height: 512 });
    const large = duplicate("large.png", "g1", { width: 2048, height: 2048 });

    expect(chooseKeeper([small, large])).toEqual({ path: large.path, reason: "resolution" });
  });

  it("falls back to the larger file at equal resolution", () => {
    const light = duplicate("light.png", "g1", { width: 512, height: 512, size: 1000 });
    const heavy = duplicate("heavy.png", "g1", { width: 512, height: 512, size: 5000 });

    expect(chooseKeeper([light, heavy])).toEqual({ path: heavy.path, reason: "size" });
  });

  it("prefers the captioned copy when resolution and size match", () => {
    const bare = duplicate("bare.png", "g1", { width: 512, height: 512, size: 1000 });
    const captioned = duplicate("captioned.png", "g1", {
      width: 512,
      height: 512,
      size: 1000,
      description: "A red car.",
      has_description: true,
    });

    expect(chooseKeeper([bare, captioned])).toEqual({
      path: captioned.path,
      reason: "caption",
    });
  });

  it("settles a total tie by name, so the default is deterministic", () => {
    const first = duplicate("a.png", "g1", { width: 512, height: 512, size: 1000 });
    const second = duplicate("b.png", "g1", { width: 512, height: 512, size: 1000 });

    expect(chooseKeeper([second, first])).toEqual({ path: first.path, reason: "name" });
  });

  it("treats unknown dimensions as smallest rather than crashing", () => {
    const unknown = duplicate("clip.mkv", "g1", { width: null, height: null, size: 9000 });
    const known = duplicate("clip.mp4", "g1", { width: 640, height: 480, size: 100 });

    expect(chooseKeeper([unknown, known])).toEqual({ path: known.path, reason: "resolution" });
  });

  it("returns nothing for an empty group", () => {
    expect(chooseKeeper([])).toBeNull();
  });
});

describe("duplicateOpenOutcome", () => {
  it("stays quiet when there are groups to compare", () => {
    expect(duplicateOpenOutcome(0, 3)).toBeNull();
    expect(duplicateOpenOutcome(4, 3)).toBeNull();
  });

  it("points at a re-run when every finding lost its partner", () => {
    expect(duplicateOpenOutcome(2, 0)).toEqual({
      variant: "warning",
      message:
        "2 duplicate findings have no partner left to compare. Re-run find duplicates to rebuild them.",
    });
  });

  it("reads as English for a single finding", () => {
    expect(duplicateOpenOutcome(1, 0)?.message).toBe(
      "1 duplicate finding has no partner left to compare. Re-run find duplicates to rebuild it.",
    );
  });

  it("says the folder is clean when there was nothing to compare at all", () => {
    expect(duplicateOpenOutcome(0, 0)).toEqual({
      variant: "warning",
      message: "No duplicate groups left in this folder.",
    });
  });
});
