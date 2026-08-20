export interface PackedMasonryCard<T> {
  item: T;
  index: number;
  lane: number;
  top: number;
  height: number;
}

export interface PackedMasonryLayout<T> {
  packed: PackedMasonryCard<T>[];
  totalHeight: number;
}

/**
 * Round-robin column masonry: item `i` goes to column `i % columnCount`.
 * That keeps sort order left-to-right along the top of the grid, then stacks
 * tightly down each column so a short card does not leave a hole beside a tall one.
 */
export function packColumnMasonry<T>(
  items: readonly T[],
  options: {
    columnCount: number;
    gap: number;
    heightOf: (item: T, index: number) => number;
  },
): PackedMasonryLayout<T> {
  const columnCount = Math.max(1, options.columnCount);
  if (items.length === 0) return { packed: [], totalHeight: 0 };

  const columnHeights = Array.from({ length: columnCount }, () => 0);
  const packed = items.map((item, index) => {
    const lane = index % columnCount;
    const height = Math.max(0, options.heightOf(item, index));
    const top = columnHeights[lane];
    columnHeights[lane] = top + height + options.gap;
    return { item, index, lane, top, height };
  });

  const totalHeight = Math.max(
    0,
    ...columnHeights.map((height) => (height > 0 ? height - options.gap : 0)),
  );

  return { packed, totalHeight };
}

export function masonryItemOrigin(
  lane: number,
  columnWidth: number,
  gap: number,
): { width: number; left: number } {
  return {
    width: columnWidth,
    left: lane * (columnWidth + gap),
  };
}

export function visibleMasonryCards<T>(
  packed: readonly PackedMasonryCard<T>[],
  view: { start: number; end: number },
): PackedMasonryCard<T>[] {
  return packed.filter((card) => card.top < view.end && card.top + card.height > view.start);
}
