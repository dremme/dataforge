import type { FolderChangesResponse, FolderResponse, GalleryItem, Subfolder } from "@/shared/types";

/** Blank counts are what `useSubfolderStats` reads as "ask again" for the new fingerprint. */
function blankStaleCounts(subfolders: Subfolder[], stale: string[]): Subfolder[] {
  if (stale.length === 0) return subfolders;

  const stalePaths = new Set(stale);
  return subfolders.map((subfolder) =>
    stalePaths.has(subfolder.path)
      ? {
          ...subfolder,
          file_count: null,
          captioned_count: null,
          issue_count: null,
          duplicate_count: null,
        }
      : subfolder,
  );
}

export function applyFolderDelta(
  folder: FolderResponse,
  delta: FolderChangesResponse,
): FolderResponse {
  const subfolders = blankStaleCounts(folder.subfolders, delta.stale_subfolders);

  if (delta.changed.length === 0 && delta.removed.length === 0) {
    return folder.fingerprint === delta.fingerprint && subfolders === folder.subfolders
      ? folder
      : { ...folder, subfolders, fingerprint: delta.fingerprint };
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
    subfolders,
    items,
    item_count: items.length,
    fingerprint: delta.fingerprint,
  };
}
