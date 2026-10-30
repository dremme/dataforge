import { describe, expect, it } from "vitest";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { isUncaptionedItem, nextIndexWhere } from "./reviewJump";

const items = ["a", "b", "c", "d", "e"].map((name) =>
  mediaItem(`${name}.png`, HOME_PATH, { has_description: name === "a" || name === "d" }),
);

describe("nextIndexWhere", () => {
  it("finds the next match after the current item", () => {
    expect(nextIndexWhere(items, 1, isUncaptionedItem, 1)).toBe(2);
  });

  it("walks backwards when asked", () => {
    expect(nextIndexWhere(items, 4, isUncaptionedItem, -1)).toBe(2);
  });

  it("wraps past either end", () => {
    expect(nextIndexWhere(items, 4, isUncaptionedItem, 1)).toBe(1);
    expect(nextIndexWhere(items, 1, isUncaptionedItem, -1)).toBe(4);
  });

  it("never lands on the current item, even when it is the only match", () => {
    const one = items.map((item, index) => ({ ...item, has_description: index !== 2 }));
    expect(nextIndexWhere(one, 2, isUncaptionedItem, 1)).toBe(-1);
  });

  it("reports -1 when nothing matches", () => {
    const none = items.map((item) => ({ ...item, has_description: true }));
    expect(nextIndexWhere(none, 0, isUncaptionedItem, 1)).toBe(-1);
  });
});
