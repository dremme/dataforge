import { describe, expect, it } from "vitest";
import { packColumnMasonry, visibleMasonryCards } from "./packColumnMasonry";

interface TestItem {
  path: string;
  height: number;
}

function item(path: string, height: number): TestItem {
  return { path, height };
}

function pack(items: TestItem[], columnCount = 3) {
  return packColumnMasonry(items, {
    columnCount,
    gap: 20,
    heightOf: (entry) => entry.height,
  });
}

/** `count` cards of `height`, named `0.png`, `1.png`, ... */
function ladder(count: number, height: number): TestItem[] {
  return Array.from({ length: count }, (_, index) => item(`${index}.png`, height));
}

describe("packColumnMasonry", () => {
  it("returns an empty layout when there are no items", () => {
    expect(pack([])).toEqual({ cards: [], columnCount: 3, totalHeight: 0 });
  });

  it("places the first items left to right in sort order", () => {
    const { cards } = pack([item("a.png", 100), item("b.png", 400), item("c.png", 100)]);

    expect(cards.map((card) => [card.item.path, card.lane, card.top])).toEqual([
      ["a.png", 0, 0],
      ["b.png", 1, 0],
      ["c.png", 2, 0],
    ]);
  });

  it("stacks the next item under its own column, not under the tallest neighbor", () => {
    const { cards } = pack([
      item("a.png", 100),
      item("b.png", 400),
      item("c.png", 100),
      item("d.png", 80),
    ]);

    const fourth = cards.find((card) => card.item.path === "d.png");
    expect(fourth?.lane).toBe(0);
    expect(fourth?.top).toBe(120);
  });

  it("sizes the gallery to the tallest packed column", () => {
    expect(pack([item("a.png", 100), item("b.png", 400), item("c.png", 100)]).totalHeight).toBe(
      400,
    );
  });
});

describe("visibleMasonryCards", () => {
  it("keeps cards that intersect the viewport window", () => {
    const layout = pack([
      item("a.png", 100),
      item("b.png", 100),
      item("c.png", 100),
      item("d.png", 100),
    ]);

    expect(
      visibleMasonryCards(layout, { start: 0, end: 50 }).map((card) => card.item.path),
    ).toEqual(["a.png", "b.png", "c.png"]);
    expect(
      visibleMasonryCards(layout, { start: 110, end: 200 }).map((card) => card.item.path),
    ).toEqual(["d.png"]);
  });

  it("finds each lane's own window when the lanes are at very different depths", () => {
    // Lane 0 carries one very tall card, so at 5000px lane 0 is still on its
    // first card while lanes 1 and 2 are dozens of cards deep.
    const items = [item("tall.png", 20_000), ...ladder(300, 100)];
    const layout = packColumnMasonry(items, {
      columnCount: 3,
      gap: 20,
      heightOf: (entry) => entry.height,
    });

    const visible = visibleMasonryCards(layout, { start: 5000, end: 5200 });
    const lanes = new Set(visible.map((card) => card.lane));

    expect(lanes).toEqual(new Set([0, 1, 2]));
    expect(visible.some((card) => card.item.path === "tall.png")).toBe(true);
    // Every card returned really does straddle the window.
    for (const card of visible) {
      expect(card.top).toBeLessThan(5200);
      expect(card.top + card.height).toBeGreaterThan(5000);
    }
  });

  it("leaves out everything below the window", () => {
    // Three lanes of 100px cards on a 20px gap: slot tops are 0, 120, 240, 360.
    const layout = pack(ladder(300, 100));
    const visible = visibleMasonryCards(layout, { start: 0, end: 250 });

    expect(visible.map((card) => card.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("returns cards in item order across lanes", () => {
    const layout = pack(ladder(30, 100));
    const visible = visibleMasonryCards(layout, { start: 0, end: 500 });

    expect(visible.map((card) => card.index)).toEqual(
      [...visible].map((card) => card.index).sort((left, right) => left - right),
    );
  });
});
