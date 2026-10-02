import type { FolderFavorite } from "@/shared/types";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import { folderLeafName, folderPathsEqual, normalizeFolderPath } from "./folderPath";

const FAVORITES_CACHE_KEY = "gallery-folder-favorites";

function isFolderFavorite(value: unknown): value is FolderFavorite {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<FolderFavorite>;
  return typeof entry.name === "string" && typeof entry.path === "string";
}

/** The local mirror of the server's favorites, for an instant first paint and outages. */
export function readCachedFolderFavorites(): FolderFavorite[] {
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

export function cacheFolderFavorites(favorites: FolderFavorite[]): void {
  writeStoredJson(FAVORITES_CACHE_KEY, favorites);
}
