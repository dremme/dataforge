import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import type { FolderResponse } from "@/shared/types";

/**
 * Recently opened folders, kept in memory for the session.
 *
 * Navigation used to refetch from scratch every time, so stepping into a folder
 * and back cost a full cold load and wiped the grid to skeletons on the way. A
 * cached payload lets the previous folder paint immediately while its
 * fingerprint is checked in the background.
 *
 * Module-level singleton, matching `previewLoader`; cleared on page reload.
 */
const MAX_CACHED_FOLDERS = 10;

const cache = new Map<string, FolderResponse>();

function cacheKey(folderPath: string): string {
  return normalizeFolderPath(folderPath).toLowerCase();
}

export function readCachedFolder(folderPath: string | undefined): FolderResponse | null {
  if (!folderPath) return null;

  const key = cacheKey(folderPath);
  const hit = cache.get(key);
  if (!hit) return null;

  // Refresh recency so the folders being navigated survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function writeCachedFolder(data: FolderResponse): void {
  const key = cacheKey(data.path);
  cache.delete(key);
  cache.set(key, data);

  while (cache.size > MAX_CACHED_FOLDERS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Forget a folder the backend just told us is gone. */
export function evictCachedFolder(folderPath: string | undefined): void {
  if (!folderPath) return;
  cache.delete(cacheKey(folderPath));
}

export function clearFolderCache(): void {
  cache.clear();
}
