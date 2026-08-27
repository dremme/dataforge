import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import type { FolderResponse } from "@/shared/types";

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

export function evictCachedFolder(folderPath: string | undefined): void {
  if (!folderPath) return;
  cache.delete(cacheKey(folderPath));
}

export function clearFolderCache(): void {
  cache.clear();
}
