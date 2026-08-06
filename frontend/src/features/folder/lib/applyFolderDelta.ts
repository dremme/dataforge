import type { FolderChangesResponse, FolderResponse, GalleryItem } from "@/shared/types";

/**
 * Patch a folder response in place from a `/api/folders/changes` delta.
 *
 * Items are keyed by path. A changed item replaces the one already there, keeping its
 * position so the grid does not reshuffle under the user; an item that is new to us
 * goes at the end, where the next full folder will sort it properly.
 *
 * Returns the same object when nothing changed, so React can skip the re-render.
 */
export function applyFolderDelta(
  folder: FolderResponse,
  delta: FolderChangesResponse,
): FolderResponse {
  if (delta.changed.length === 0 && delta.removed.length === 0) {
    return folder.fingerprint === delta.fingerprint
      ? folder
      : { ...folder, fingerprint: delta.fingerprint };
  }

  const changedByPath = new Map(delta.changed.map((item) => [item.path, item]));
  const removedPaths = new Set(delta.removed);

  const items: GalleryItem[] = [];
  for (const item of folder.items) {
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
    ...folder,
    items,
    item_count: items.length,
    fingerprint: delta.fingerprint,
  };
}
