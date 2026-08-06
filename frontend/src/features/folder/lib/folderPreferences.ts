import { fetchFolder } from "@/features/folder/api/folderContents";
import { resolveFolderError } from "@/shared/api/http";
import type { FolderResponse } from "@/shared/types";
import { writeCachedFolder } from "./folderCache";
import { folderPathsEqual, normalizeFolderPath } from "./folderPath";
import { LOAD_RETRY_DELAYS_MS, withRetry } from "@/shared/lib/retry";
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

export function promoteRecentFolder(path: string): void {
  touchRecentFolder(path);
}

function cacheFolderPreference(path: string): void {
  cacheLastFolder(path);
  touchRecentFolder(path);
}

interface FolderFetchOptions {
  updateRecent?: boolean;
  signal?: AbortSignal;
}

/**
 * Retry only while the API server has yet to come up.
 *
 * The ladder exists for cold start, when the frontend is served before the
 * backend is listening. Retrying anything else — a 500, a folder the backend
 * choked on — just piles more heavy listings onto a struggling server.
 */
function shouldRetryFolder(error: unknown): boolean {
  return resolveFolderError(error)?.kind === "backend-unreachable";
}

export async function fetchFolderWithRetry(
  folderPath?: string,
  { updateRecent = true, signal }: FolderFetchOptions = {},
): Promise<FolderResponse> {
  return withRetry(
    async () => {
      const data = await fetchFolder(folderPath, signal);
      if (updateRecent) {
        cacheFolderPreference(data.path);
      } else {
        cacheLastFolder(data.path);
      }
      writeCachedFolder(data);
      return data;
    },
    LOAD_RETRY_DELAYS_MS,
    shouldRetryFolder,
  );
}

async function loadDefaultFolder(options: FolderFetchOptions = {}): Promise<FolderResponse> {
  try {
    return await fetchFolderWithRetry(undefined, options);
  } catch (firstError) {
    const cached = getCachedLastFolder();
    if (!cached) {
      throw firstError;
    }
    return fetchFolderWithRetry(cached, options);
  }
}

export async function loadFolderContents(
  folderPath?: string,
  options: FolderFetchOptions = {},
): Promise<FolderResponse> {
  if (folderPath !== undefined) {
    return fetchFolderWithRetry(folderPath, options);
  }
  return loadDefaultFolder(options);
}
