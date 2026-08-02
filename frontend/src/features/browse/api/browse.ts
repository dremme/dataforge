import { requestJson } from "@/shared/api/http";
import type {
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

/** Per-child media/caption counts, fetched after the grid has already rendered. */
export async function fetchSubfolderStats(
  folderPath: string,
  signal?: AbortSignal,
): Promise<SubfolderStatsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<SubfolderStatsResponse>(`/api/browse/subfolder-stats?${params}`, { signal });
}
