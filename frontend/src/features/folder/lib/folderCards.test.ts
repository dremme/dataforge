import { describe, expect, it } from "vitest";
import type { Subfolder } from "@/shared/types";
import {
  FOLDER_CLAMP_LIMIT,
  FOLDER_CLAMP_MIN_HIDDEN,
  clampFolders,
  folderCardLabel,
  folderFindings,
  hasFolderFindings,
} from "./folderCards";

function makeFolder(overrides: Partial<Subfolder> = {}): Subfolder {
  return {
    name: "Album",
    path: "C:\\Photos\\Album",
    file_count: 2,
    captioned_count: 1,
    issue_count: 0,
    duplicate_count: 0,
    ...overrides,
  };
}

function makeFolders(count: number, overrides: (index: number) => Partial<Subfolder> = () => ({})) {
  return Array.from({ length: count }, (_unused, index) =>
    makeFolder({ name: `Album ${index}`, path: `C:\\Photos\\${index}`, ...overrides(index) }),
  );
}

describe("folderFindings", () => {
  it("counts caption issues and duplicates, singular and plural", () => {
    expect(folderFindings(makeFolder({ issue_count: 1 }))).toEqual(["1 caption issue"]);
    expect(folderFindings(makeFolder({ issue_count: 3 }))).toEqual(["3 caption issues"]);
    expect(folderFindings(makeFolder({ duplicate_count: 1 }))).toEqual(["1 duplicate"]);
    expect(folderFindings(makeFolder({ issue_count: 2, duplicate_count: 4 }))).toEqual([
      "2 caption issues",
      "4 duplicates",
    ]);
  });

  it("reports nothing while the counts have not arrived", () => {
    const pending = makeFolder({ issue_count: null, duplicate_count: null });

    expect(folderFindings(pending)).toEqual([]);
    expect(hasFolderFindings(pending)).toBe(false);
  });
});

describe("folderCardLabel", () => {
  it("appends the findings to the name, and only then", () => {
    expect(folderCardLabel(makeFolder({ name: "Clean" }))).toBe("Clean");
    expect(folderCardLabel(makeFolder({ name: "Needs review", issue_count: 3 }))).toBe(
      "Needs review (3 caption issues)",
    );
  });
});

describe("clampFolders", () => {
  // Enough hidden to clear the floor, so the clamp engages whatever the constants are tuned to.
  const HIDDEN = FOLDER_CLAMP_MIN_HIDDEN + 3;

  it("leaves a list at the limit alone", () => {
    const clamp = clampFolders(makeFolders(FOLDER_CLAMP_LIMIT));

    expect(clamp.visible).toHaveLength(FOLDER_CLAMP_LIMIT);
    expect(clamp.hidden).toBe(0);
  });

  it("leaves a short tail alone rather than hiding it behind a button", () => {
    const total = FOLDER_CLAMP_LIMIT + FOLDER_CLAMP_MIN_HIDDEN - 1;

    const clamp = clampFolders(makeFolders(total));

    expect(clamp.visible).toHaveLength(total);
    expect(clamp.hidden).toBe(0);
  });

  it("clamps once the tail is worth hiding", () => {
    const clamp = clampFolders(makeFolders(FOLDER_CLAMP_LIMIT + HIDDEN));

    expect(clamp.visible).toHaveLength(FOLDER_CLAMP_LIMIT);
    expect(clamp.visible[0]?.name).toBe("Album 0");
    expect(clamp.hidden).toBe(HIDDEN);
  });

  it("counts only the flagged folders it actually hid", () => {
    const flagged = [0, FOLDER_CLAMP_LIMIT, FOLDER_CLAMP_LIMIT + 1];
    const folders = makeFolders(FOLDER_CLAMP_LIMIT + HIDDEN, (index) =>
      flagged.includes(index) ? { issue_count: 1 } : {},
    );

    expect(clampFolders(folders).hiddenFlagged).toBe(2);
  });

  it("counts duplicates as needing review too", () => {
    const folders = makeFolders(FOLDER_CLAMP_LIMIT + HIDDEN, (index) =>
      index === FOLDER_CLAMP_LIMIT ? { duplicate_count: 5 } : {},
    );

    expect(clampFolders(folders).hiddenFlagged).toBe(1);
  });

  it("flags nothing while the counts are still pending", () => {
    const folders = makeFolders(FOLDER_CLAMP_LIMIT + HIDDEN, () => ({
      issue_count: null,
      duplicate_count: null,
    }));

    expect(clampFolders(folders).hiddenFlagged).toBe(0);
  });

  it("copies the list rather than handing back the caller's array", () => {
    const folders = makeFolders(3);

    expect(clampFolders(folders).visible).not.toBe(folders);
  });
});
