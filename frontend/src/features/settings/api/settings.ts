import { forgetVisionModelId } from "@/features/automation/api/visionLlm";
import { postJson, putJson, requestJson } from "@/shared/api/http";
import type {
  AboutResponse,
  AppSettingsResponse,
  AppSettingsUpdate,
  RememberedDataResponse,
  ServiceProbeRequest,
  ServiceProbeResponse,
  ThumbnailCacheCleared,
  ThumbnailCacheStats,
} from "@/shared/types";

export function fetchAppSettings(signal?: AbortSignal): Promise<AppSettingsResponse> {
  return requestJson<AppSettingsResponse>("/api/settings", { signal });
}

export async function saveAppSettings(update: AppSettingsUpdate): Promise<AppSettingsResponse> {
  const saved = await putJson<AppSettingsResponse>("/api/settings", update);
  forgetVisionModelId();
  return saved;
}

export function probeService(request: ServiceProbeRequest): Promise<ServiceProbeResponse> {
  return postJson<ServiceProbeResponse>("/api/settings/probe", request);
}

export function fetchThumbnailCacheStats(signal?: AbortSignal): Promise<ThumbnailCacheStats> {
  return requestJson<ThumbnailCacheStats>("/api/thumbnails/cache", { signal });
}

export function clearThumbnailCache(): Promise<ThumbnailCacheCleared> {
  return requestJson<ThumbnailCacheCleared>("/api/thumbnails/cache", { method: "DELETE" });
}

export function fetchRememberedData(signal?: AbortSignal): Promise<RememberedDataResponse> {
  return requestJson<RememberedDataResponse>("/api/preferences/remembered", { signal });
}

export function forgetRememberedData(
  kind: "job-options" | "display-modes",
): Promise<RememberedDataResponse> {
  return requestJson<RememberedDataResponse>(`/api/preferences/remembered/${kind}`, {
    method: "DELETE",
  });
}

export function fetchAbout(signal?: AbortSignal): Promise<AboutResponse> {
  return requestJson<AboutResponse>("/api/system/about", { signal });
}
