import { normalizeFolderPath } from "@/features/browse/lib/folderPath";
import type { BrowseResponse } from "@/shared/types";

/**
 * Recently browsed folders, kept in memory for the session.
 *
 * Navigation used to refetch from scratch every time, so stepping into a folder
 * and back cost a full cold load and wiped the grid to skeletons on the way. A
 * cached payload lets the previous folder paint immediately while its
 * fingerprint is checked in the background.
 *
 * Module-level singleton, matching `previewLoader`; cleared on page reload.
 */
const MAX_CACHED_FOLDERS = 10;

const cache = new Map<string, BrowseResponse>();

function cacheKey(folderPath: string): string {
  return normalizeFolderPath(folderPath).toLowerCase();
}

export function readCachedBrowse(folderPath: string | undefined): BrowseResponse | null {
  if (!folderPath) return null;

  const key = cacheKey(folderPath);
  const hit = cache.get(key);
  if (!hit) return null;

  // Refresh recency so the folders being navigated survive eviction.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function writeCachedBrowse(data: BrowseResponse): void {
  const key = cacheKey(data.folder);
  cache.delete(key);
  cache.set(key, data);

  while (cache.size > MAX_CACHED_FOLDERS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Forget a folder the backend just told us is gone. */
export function evictCachedBrowse(folderPath: string | undefined): void {
  if (!folderPath) return;
  cache.delete(cacheKey(folderPath));
}

export function clearBrowseCache(): void {
  cache.clear();
}
