import { fetchFolder, type FetchFolderOptions } from "@/features/folder/api/folderContents";
import { isAbortError } from "@/shared/api/http";
import type { FolderResponse } from "@/shared/types";
import { folderPathsEqual, normalizeFolderPath } from "./folderPath";
import { readStored, readStoredJson, writeStored, writeStoredJson } from "@/shared/lib/storage";

const FOLDER_CACHE_KEY = "gallery-last-folder";
const RECENT_FOLDERS_KEY = "gallery-recent-folders";
const MAX_RECENT_FOLDERS = 8;

export function getCachedLastFolder(): string | null {
  const stored = readStored(FOLDER_CACHE_KEY);
  return stored ? normalizeFolderPath(stored) : null;
}

function readRecentFoldersRaw(): string[] {
  return readStoredJson<string[]>(
    RECENT_FOLDERS_KEY,
    (parsed) =>
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        : null,
    [],
  );
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
  writeStoredJson(RECENT_FOLDERS_KEY, dedupeRecentFolders(paths));
}

export function readRecentFolderPaths(): string[] {
  return dedupeRecentFolders(readRecentFoldersRaw());
}

export function clearRecentFolders(): void {
  writeStoredJson(RECENT_FOLDERS_KEY, []);
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

function cacheLastFolder(path: string): void {
  const normalized = normalizeFolderPath(path);
  if (!normalized) return;

  writeStored(FOLDER_CACHE_KEY, normalized);
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

/** A folder the user opened: the next start lands here, and it heads the recent list. */
export function rememberOpenedFolder(path: string): void {
  cacheLastFolder(path);
  touchRecentFolder(path);
}

/** A full listing; with no path, the server's default, else the last folder opened. */
export async function loadFolderContents(
  folderPath?: string,
  options: FetchFolderOptions = {},
): Promise<FolderResponse> {
  if (folderPath !== undefined) return fetchFolder(folderPath, options);

  try {
    return await fetchFolder(undefined, options);
  } catch (firstError) {
    const cached = getCachedLastFolder();
    if (!cached || isAbortError(firstError)) throw firstError;
    return fetchFolder(cached, options);
  }
}
