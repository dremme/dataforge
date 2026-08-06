import { requestJson } from "@/shared/api/http";
import type {
  FolderChangesResponse,
  FolderFingerprintResponse,
  FolderResponse,
  SubfolderStatsResponse,
} from "@/shared/types";

export async function fetchFolder(
  folderPath?: string,
  signal?: AbortSignal,
): Promise<FolderResponse> {
  const params = new URLSearchParams();
  if (folderPath) params.set("path", folderPath);

  const query = params.toString();
  return requestJson<FolderResponse>(`/api/folders/contents${query ? `?${query}` : ""}`, {
    signal,
  });
}

export async function fetchFolderFingerprint(
  folderPath: string,
  signal?: AbortSignal,
): Promise<FolderFingerprintResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderFingerprintResponse>(`/api/folders/fingerprint?${params}`, { signal });
}

/**
 * What changed since `since`, so an edit to one file costs one item instead of a folder.
 *
 * Answers `full` when the server cannot produce a delta — an unknown baseline, or a
 * change to the folder's subfolders or sysprompt — and the caller reloads as before.
 */
export async function fetchFolderChanges(
  folderPath: string,
  since: string,
  signal?: AbortSignal,
): Promise<FolderChangesResponse> {
  const params = new URLSearchParams({ path: folderPath, since });
  return requestJson<FolderChangesResponse>(`/api/folders/changes?${params}`, { signal });
}

/** Per-child media/caption counts, fetched after the grid has already rendered. */
export async function fetchSubfolderStats(
  folderPath: string,
  signal?: AbortSignal,
): Promise<SubfolderStatsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<SubfolderStatsResponse>(`/api/folders/subfolder-stats?${params}`, { signal });
}
