import { serverEventsTabId } from "@/shared/api/eventStream";
import { requestJson } from "@/shared/api/http";
import type {
  FolderChangesResponse,
  FolderFingerprintResponse,
  FolderResponse,
  SubfolderStatsResponse,
} from "@/shared/types";

/** The tab id asks the server to watch the folder for this tab. */
function folderParams(folderPath?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (folderPath) params.set("path", folderPath);
  params.set("tab", serverEventsTabId());
  return params;
}

export interface FetchFolderOptions {
  signal?: AbortSignal;
  /**
   * A speculative read: the server neither watches it (it keeps only a few folders per tab)
   * nor remembers it as the folder to start in.
   */
  prefetch?: boolean;
}

export async function fetchFolder(
  folderPath?: string,
  { signal, prefetch = false }: FetchFolderOptions = {},
): Promise<FolderResponse> {
  const params = folderParams(folderPath);
  if (prefetch) params.set("prefetch", "true");
  return requestJson<FolderResponse>(`/api/folders/contents?${params}`, { signal });
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
  /** The user is opening the folder, so the server remembers it as the one to start in. */
  opened = false,
): Promise<FolderChangesResponse> {
  const params = folderParams(folderPath);
  params.set("since", since);
  if (opened) params.set("opened", "true");
  return requestJson<FolderChangesResponse>(`/api/folders/changes?${params}`, { signal });
}

export async function fetchSubfolderStats(
  folderPath: string,
  signal?: AbortSignal,
): Promise<SubfolderStatsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<SubfolderStatsResponse>(`/api/folders/subfolder-stats?${params}`, { signal });
}
