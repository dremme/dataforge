import { requestJson } from "@/shared/api/http";
import type {
  FolderChildrenResponse,
  FolderCreateResponse,
  FolderFavoritesResponse,
  FolderOpenResponse,
  FolderRootsResponse,
} from "@/shared/types";

export async function fetchFolderRoots(): Promise<FolderRootsResponse> {
  return requestJson<FolderRootsResponse>("/api/folders/roots");
}

/** Immediate child folders only — cheaper than full /api/browse for tree UIs. */
export async function fetchFolderChildren(folderPath: string): Promise<FolderChildrenResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderChildrenResponse>(`/api/folders/children?${params}`);
}

export async function fetchFolderFavorites(): Promise<FolderFavoritesResponse> {
  return requestJson<FolderFavoritesResponse>("/api/folders/favorites");
}

export async function addFolderFavorite(folderPath: string): Promise<FolderFavoritesResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderFavoritesResponse>(`/api/folders/favorites?${params}`, {
    method: "POST",
  });
}

export async function removeFolderFavorite(folderPath: string): Promise<FolderFavoritesResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderFavoritesResponse>(`/api/folders/favorites?${params}`, {
    method: "DELETE",
  });
}

export async function openFolderInExplorer(folderPath: string): Promise<FolderOpenResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderOpenResponse>(`/api/folders/open?${params}`, {
    method: "POST",
  });
}

export async function createFolder(
  parentPath: string,
  name: string,
): Promise<FolderCreateResponse> {
  const params = new URLSearchParams({ path: parentPath, name });
  return requestJson<FolderCreateResponse>(`/api/folders/create?${params}`, {
    method: "POST",
  });
}
