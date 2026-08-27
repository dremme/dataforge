import { serverEventsTabId } from "@/shared/api/eventStream";
import { requestJson } from "@/shared/api/http";
import type {
  FolderChangesResponse,
  FolderFingerprintResponse,
  FolderResponse,
  SubfolderStatsResponse,
} from "@/shared/types";

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

export async function fetchFolderChanges(
  folderPath: string,
  since: string,
  signal?: AbortSignal,
): Promise<FolderChangesResponse> {
  const params = folderParams(folderPath);
  params.set("since", since);
  return requestJson<FolderChangesResponse>(`/api/folders/changes?${params}`, { signal });
}

export async function fetchSubfolderStats(
  folderPath: string,
  signal?: AbortSignal,
): Promise<SubfolderStatsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<SubfolderStatsResponse>(`/api/folders/subfolder-stats?${params}`, { signal });
}
