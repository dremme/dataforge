import { describe, expect, it } from "vitest";
import type { Subfolder } from "@/shared/types";
import { carrySubfolderCounts } from "./subfolderCounts";

function subfolder(name: string, fileCount: number | null): Subfolder {
  return {
    name,
    path: `C:\\datasets\\${name}`,
    file_count: fileCount,
    captioned_count: fileCount === null ? null : 1,
    issue_count: fileCount === null ? null : 0,
    duplicate_count: fileCount === null ? null : 0,
  };
}

describe("carrySubfolderCounts", () => {
  it("keeps the old counts for folders a full listing left blank", () => {
    const held = [subfolder("album", 4), subfolder("gone", 2)];

    const { subfolders, carried } = carrySubfolderCounts(held, [
      subfolder("album", null),
      subfolder("new", null),
    ]);

    expect(subfolders.map((entry) => entry.file_count)).toEqual([4, null]);
    expect(carried).toBe(true);
  });

  it("returns the fresh list untouched when there is nothing to carry", () => {
    const fresh = [subfolder("album", null)];

    const result = carrySubfolderCounts([], fresh);

    expect(result.subfolders).toBe(fresh);
    expect(result.carried).toBe(false);
  });
});
