import { requestJson } from "./http";
import type { BrowseFingerprintResponse, BrowseResponse } from "../types";

export async function fetchBrowse(folderPath?: string): Promise<BrowseResponse> {
  const params = new URLSearchParams();
  if (folderPath) params.set("path", folderPath);

  const query = params.toString();
  return requestJson<BrowseResponse>(`/api/browse${query ? `?${query}` : ""}`);
}

export async function fetchBrowseFingerprint(
  folderPath: string,
): Promise<BrowseFingerprintResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<BrowseFingerprintResponse>(`/api/browse/fingerprint?${params}`);
}
