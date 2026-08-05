import { requestJson } from "@/shared/api/http";
import type {
  BrowseChangesResponse,
  BrowseFingerprintResponse,
  BrowseResponse,
  SubfolderStatsResponse,
} from "@/shared/types";

export async function fetchBrowse(
  folderPath?: string,
  signal?: AbortSignal,
): Promise<BrowseResponse> {
  const params = new URLSearchParams();
  if (folderPath) params.set("path", folderPath);

  const query = params.toString();
  return requestJson<BrowseResponse>(`/api/browse${query ? `?${query}` : ""}`, { signal });
}

export async function fetchBrowseFingerprint(
  folderPath: string,
  signal?: AbortSignal,
): Promise<BrowseFingerprintResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<BrowseFingerprintResponse>(`/api/browse/fingerprint?${params}`, { signal });
}

/**
 * What changed since `since`, so an edit to one file costs one item instead of a folder.
 *
 * Answers `full` when the server cannot produce a delta — an unknown baseline, or a
 * change to the folder's subfolders or sysprompt — and the caller reloads as before.
 */
export async function fetchBrowseChanges(
  folderPath: string,
  since: string,
  signal?: AbortSignal,
): Promise<BrowseChangesResponse> {
  const params = new URLSearchParams({ path: folderPath, since });
  return requestJson<BrowseChangesResponse>(`/api/browse/changes?${params}`, { signal });
}

/** Per-child media/caption counts, fetched after the grid has already rendered. */
export async function fetchSubfolderStats(
  folderPath: string,
  signal?: AbortSignal,
): Promise<SubfolderStatsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<SubfolderStatsResponse>(`/api/browse/subfolder-stats?${params}`, { signal });
}
