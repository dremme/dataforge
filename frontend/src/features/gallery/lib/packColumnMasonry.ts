export interface PackedMasonryCard<T> {
  item: T;
  index: number;
  lane: number;
  top: number;
  height: number;
}

export interface PackedMasonryLayout<T> {
  cards: PackedMasonryCard<T>[];
  columnCount: number;
  totalHeight: number;
}

export function packColumnMasonry<T>(
  items: readonly T[],
  options: {
    columnCount: number;
    gap: number;
    heightOf: (item: T, index: number) => number;
  },
): PackedMasonryLayout<T> {
  const columnCount = Math.max(1, options.columnCount);
  if (items.length === 0) return { cards: [], columnCount, totalHeight: 0 };

  const columnHeights = Array.from({ length: columnCount }, () => 0);
  const cards = items.map((item, index) => {
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

  return { cards, columnCount, totalHeight };
}

function laneLength(count: number, lane: number, columnCount: number): number {
  return Math.max(0, Math.ceil((count - lane) / columnCount));
}

function firstBelow<T>(
  cards: readonly PackedMasonryCard<T>[],
  lane: number,
  columnCount: number,
  length: number,
  start: number,
): number {
  let low = 0;
  let high = length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const card = cards[lane + middle * columnCount];
    if (card.top + card.height > start) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

export function visibleMasonryCards<T>(
  layout: PackedMasonryLayout<T>,
  view: { start: number; end: number },
): PackedMasonryCard<T>[] {
  const { cards, columnCount } = layout;
  const visible: PackedMasonryCard<T>[] = [];

  for (let lane = 0; lane < columnCount; lane += 1) {
    const length = laneLength(cards.length, lane, columnCount);
    const first = firstBelow(cards, lane, columnCount, length, view.start);

    for (let slot = first; slot < length; slot += 1) {
      const card = cards[lane + slot * columnCount];
      if (card.top >= view.end) break;
      visible.push(card);
    }
  }

  return visible.sort((left, right) => left.index - right.index);
}
