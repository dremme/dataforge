import {
  addFolderFavorite,
  fetchFolderFavorites,
  removeFolderFavorite,
} from "@/features/browse/api/folders";
import type { FolderFavorite } from "@/shared/types";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import { folderLeafName, folderPathsEqual, normalizeFolderPath } from "./folderPath";

const FAVORITES_CACHE_KEY = "gallery-folder-favorites";

let memoryCache: FolderFavorite[] | null = null;
let inflightRefresh: Promise<FolderFavorite[]> | null = null;

function isFolderFavorite(value: unknown): value is FolderFavorite {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<FolderFavorite>;
  return typeof entry.name === "string" && typeof entry.path === "string";
}

function readStorageCache(): FolderFavorite[] {
  return readStoredJson<FolderFavorite[]>(
    FAVORITES_CACHE_KEY,
    (parsed) => (Array.isArray(parsed) ? parsed.filter(isFolderFavorite) : null),
    [],
  );
}

function favoriteDisplayName(path: string): string {
  const normalized = normalizeFolderPath(path);
  if (/^[A-Z]:\\$/i.test(normalized)) {
    return normalized.slice(0, 2);
  }

  return folderLeafName(normalized);
}

export function optimisticallyAddFavorite(
  favorites: FolderFavorite[],
  folderPath: string,
): FolderFavorite[] {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return favorites;
  if (favorites.some((favorite) => folderPathsEqual(favorite.path, normalized))) {
    return favorites;
  }

  return [...favorites, { path: normalized, name: favoriteDisplayName(normalized) }];
}

export function optimisticallyRemoveFavorite(
  favorites: FolderFavorite[],
  folderPath: string,
): FolderFavorite[] {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return favorites;

  return favorites.filter((favorite) => !folderPathsEqual(favorite.path, normalized));
}

export function getCachedFolderFavorites(): FolderFavorite[] {
  if (memoryCache) return memoryCache;

  const stored = readStorageCache();
  memoryCache = stored;
  return stored;
}

export function cacheFolderFavorites(favorites: FolderFavorite[]): void {
  memoryCache = favorites;
  writeStoredJson(FAVORITES_CACHE_KEY, favorites);
}

async function fetchAndCacheFolderFavorites(): Promise<FolderFavorite[]> {
  const response = await fetchFolderFavorites();
  cacheFolderFavorites(response.favorites);
  return response.favorites;
}

export function refreshFolderFavoritesInBackground(
  onUpdated: (favorites: FolderFavorite[]) => void,
  onError?: (message: string) => void,
): void {
  if (!inflightRefresh) {
    inflightRefresh = fetchAndCacheFolderFavorites().finally(() => {
      inflightRefresh = null;
    });
  }

  void inflightRefresh
    .then((favorites) => {
      onUpdated(favorites);
    })
    .catch((error) => {
      onError?.(error instanceof Error ? error.message : "Failed to load favorites");
    });
}

export async function syncAddFolderFavorite(folderPath: string): Promise<FolderFavorite[]> {
  const response = await addFolderFavorite(normalizeFolderPath(folderPath));
  cacheFolderFavorites(response.favorites);
  return response.favorites;
}

export async function syncRemoveFolderFavorite(folderPath: string): Promise<FolderFavorite[]> {
  const response = await removeFolderFavorite(normalizeFolderPath(folderPath));
  cacheFolderFavorites(response.favorites);
  return response.favorites;
}
