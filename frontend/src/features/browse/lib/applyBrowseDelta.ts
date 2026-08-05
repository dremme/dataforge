import type { BrowseChangesResponse, BrowseResponse, GalleryItem } from "@/shared/types";

/**
 * Patch a browse response in place from a `/api/browse/changes` delta.
 *
 * Items are keyed by path. A changed item replaces the one already there, keeping its
 * position so the grid does not reshuffle under the user; an item that is new to us
 * goes at the end, where the next full browse will sort it properly.
 *
 * Returns the same object when nothing changed, so React can skip the re-render.
 */
export function applyBrowseDelta(
  browse: BrowseResponse,
  delta: BrowseChangesResponse,
): BrowseResponse {
  if (delta.changed.length === 0 && delta.removed.length === 0) {
    return browse.fingerprint === delta.fingerprint
      ? browse
      : { ...browse, fingerprint: delta.fingerprint };
  }

  const changedByPath = new Map(delta.changed.map((item) => [item.path, item]));
  const removedPaths = new Set(delta.removed);

  const items: GalleryItem[] = [];
  for (const item of browse.items) {
    if (removedPaths.has(item.path)) continue;

    const changed = changedByPath.get(item.path);
    if (changed) {
      changedByPath.delete(item.path);
      items.push(changed);
      continue;
    }

    items.push(item);
  }

  items.push(...changedByPath.values());

  return {
    ...browse,
    items,
    item_count: items.length,
    fingerprint: delta.fingerprint,
  };
}
