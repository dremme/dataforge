import type { GalleryItem } from "@/shared/types";

export function isUncaptionedItem(item: GalleryItem): boolean {
  return !item.has_description;
}

/**
 * The nearest other item that matches, walking from `index` in `direction` and wrapping past
 * either end; -1 when no other item matches. The current item never counts: a jump that lands
 * where it started reads as a key that did nothing.
 */
export function nextIndexWhere(
  items: readonly GalleryItem[],
  index: number,
  predicate: (item: GalleryItem) => boolean,
  direction: 1 | -1,
): number {
  for (let step = 1; step < items.length; step++) {
    const candidate = (index + direction * step + items.length) % items.length;
    if (predicate(items[candidate])) return candidate;
  }
  return -1;
}
