import { describe, expect, it } from "vitest";
import { packColumnMasonry, visibleMasonryCards } from "./packColumnMasonry";

function item(path: string, height: number) {
  return { path, height };
}

describe("packColumnMasonry", () => {
  it("returns an empty layout when there are no items", () => {
    expect(packColumnMasonry([], { columnCount: 3, gap: 20, heightOf: () => 100 })).toEqual({
      packed: [],
      totalHeight: 0,
    });
  });

  it("places the first items left to right in sort order", () => {
    const items = [item("a.png", 100), item("b.png", 400), item("c.png", 100)];
    const { packed } = packColumnMasonry(items, {
      columnCount: 3,
      gap: 20,
      heightOf: (entry) => entry.height,
    });

    expect(packed.map((card) => [card.item.path, card.lane, card.top])).toEqual([
      ["a.png", 0, 0],
      ["b.png", 1, 0],
      ["c.png", 2, 0],
    ]);
  });

  it("stacks the next item under its own column, not under the tallest neighbor", () => {
    const items = [item("a.png", 100), item("b.png", 400), item("c.png", 100), item("d.png", 80)];
    const { packed } = packColumnMasonry(items, {
      columnCount: 3,
      gap: 20,
      heightOf: (entry) => entry.height,
    });

    const fourth = packed.find((card) => card.item.path === "d.png");
    expect(fourth?.lane).toBe(0);
    expect(fourth?.top).toBe(120);
  });

  it("sizes the gallery to the tallest packed column", () => {
    const items = [item("a.png", 100), item("b.png", 400), item("c.png", 100)];
    const { totalHeight } = packColumnMasonry(items, {
      columnCount: 3,
      gap: 20,
      heightOf: (entry) => entry.height,
    });

    expect(totalHeight).toBe(400);
  });
});

describe("visibleMasonryCards", () => {
  it("keeps cards that intersect the viewport window", () => {
    const { packed } = packColumnMasonry(
      [item("a.png", 100), item("b.png", 100), item("c.png", 100), item("d.png", 100)],
      { columnCount: 3, gap: 20, heightOf: (entry) => entry.height },
    );

    expect(
      visibleMasonryCards(packed, { start: 0, end: 50 }).map((card) => card.item.path),
    ).toEqual(["a.png", "b.png", "c.png"]);
    expect(
      visibleMasonryCards(packed, { start: 110, end: 200 }).map((card) => card.item.path),
    ).toEqual(["d.png"]);
  });
});
