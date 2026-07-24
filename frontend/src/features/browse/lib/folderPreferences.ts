import { fetchBrowse } from "@/features/browse/api/browse";
import { isFolderNotFoundError } from "@/shared/api/http";
import type { BrowseResponse } from "@/shared/types";
import { folderPathsEqual, normalizeFolderPath } from "./folderPath";
import { LOAD_RETRY_DELAYS_MS, withRetry } from "@/shared/lib/retry";

const FOLDER_CACHE_KEY = "gallery-last-folder";
const RECENT_FOLDERS_KEY = "gallery-recent-folders";
const MAX_RECENT_FOLDERS = 8;

export function getCachedLastFolder(): string | null {
  try {
    const stored = localStorage.getItem(FOLDER_CACHE_KEY);
    if (stored) return normalizeFolderPath(stored);
  } catch {
    // Ignore storage access errors
  }
  return null;
}

function readRecentFoldersRaw(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

function dedupeRecentFolders(paths: string[]): string[] {
  const deduped: string[] = [];

  for (const path of paths) {
    const normalized = normalizeFolderPath(path);
    if (!normalized) continue;
    if (deduped.some((entry) => folderPathsEqual(entry, normalized))) continue;
    deduped.push(normalized);
  }

  return deduped;
}

function writeRecentFolders(paths: string[]): void {
  try {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(dedupeRecentFolders(paths)));
  } catch {
    // Ignore storage access errors
  }
}

export function readRecentFolderPaths(): string[] {
  return dedupeRecentFolders(readRecentFoldersRaw());
}

export function restoreRecentFolders(paths: string[]): void {
  writeRecentFolders(paths);
}

export function getRecentFoldersForPicker(
  currentFolder: string,
  favoritePaths: string[],
): string[] {
  const recent = readRecentFolderPaths().filter(
    (path) => !favoritePaths.some((favoritePath) => folderPathsEqual(favoritePath, path)),
  );

  const currentIsFavorite = favoritePaths.some((favoritePath) =>
    folderPathsEqual(favoritePath, currentFolder),
  );
  if (currentIsFavorite) {
    return recent;
  }

  const normalizedCurrent = normalizeFolderPath(currentFolder);
  if (!normalizedCurrent) {
    return recent;
  }

  return [
    normalizedCurrent,
    ...recent.filter((path) => !folderPathsEqual(path, normalizedCurrent)),
  ];
}

export function cacheLastFolder(path: string): void {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return;

  try {
    localStorage.setItem(FOLDER_CACHE_KEY, normalized);
  } catch {
    // Ignore storage access errors
  }
}

export function touchRecentFolder(path: string): void {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return;

  const recent = [
    normalized,
    ...readRecentFolderPaths().filter((entry) => !folderPathsEqual(entry, normalized)),
  ].slice(0, MAX_RECENT_FOLDERS);

  writeRecentFolders(recent);
}

export function promoteRecentFolder(path: string): void {
  touchRecentFolder(path);
}

export function cacheFolderPreference(path: string): void {
  cacheLastFolder(path);
  touchRecentFolder(path);
}

interface BrowseLoadOptions {
  updateRecent?: boolean;
}

export async function fetchBrowseWithRetry(
  folderPath?: string,
  { updateRecent = true }: BrowseLoadOptions = {},
): Promise<BrowseResponse> {
  return withRetry(
    async () => {
      const data = await fetchBrowse(folderPath);
      if (updateRecent) {
        cacheFolderPreference(data.folder);
      } else {
        cacheLastFolder(data.folder);
      }
      return data;
    },
    LOAD_RETRY_DELAYS_MS,
    (error) => !isFolderNotFoundError(error),
  );
}

async function loadDefaultBrowse(options: BrowseLoadOptions = {}): Promise<BrowseResponse> {
  try {
    return await fetchBrowseWithRetry(undefined, options);
  } catch (firstError) {
    const cached = getCachedLastFolder();
    if (!cached) {
      throw firstError;
    }
    return fetchBrowseWithRetry(cached, options);
  }
}

export async function loadBrowseFolder(
  folderPath?: string,
  options: BrowseLoadOptions = {},
): Promise<BrowseResponse> {
  if (folderPath !== undefined) {
    return fetchBrowseWithRetry(folderPath, options);
  }
  return loadDefaultBrowse(options);
}
