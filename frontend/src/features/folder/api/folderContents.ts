import { serverEventsTabId } from "@/shared/api/eventStream";
import { requestJson } from "@/shared/api/http";
import type {
  FolderChangesResponse,
  FolderFingerprintResponse,
  FolderResponse,
  SubfolderStatsResponse,
} from "@/shared/types";

/**
 * Asking about a folder is what tells the server this tab is looking at it, which is
 * how folder events find their way back to the right tab. There is no separate
 * registration to fall out of step with where the user actually is.
 */
function folderParams(folderPath?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (folderPath) params.set("path", folderPath);
  params.set("tab", serverEventsTabId());
  return params;
}

export async function fetchFolder(
  folderPath?: string,
  signal?: AbortSignal,
): Promise<FolderResponse> {
  return requestJson<FolderResponse>(`/api/folders/contents?${folderParams(folderPath)}`, {
    signal,
  });
}

export async function fetchFolderFingerprint(
  folderPath: string,
  signal?: AbortSignal,
): Promise<FolderFingerprintResponse> {
  const params = folderParams(folderPath);
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
  const params = folderParams(folderPath);
  params.set("since", since);
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
