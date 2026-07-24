import { describe, expect, it } from "vitest";
import { groupIntoRows } from "./groupIntoRows";

describe("groupIntoRows", () => {
  it("groups items into rows by column count", () => {
    expect(groupIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array when there are no items", () => {
    expect(groupIntoRows([], 3)).toEqual([]);
  });
});
