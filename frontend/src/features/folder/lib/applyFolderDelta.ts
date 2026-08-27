import type { FolderChangesResponse, FolderResponse, GalleryItem } from "@/shared/types";

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
