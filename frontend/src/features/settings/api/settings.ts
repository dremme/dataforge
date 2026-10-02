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

export const settingsKeys = {
  app: ["app-settings"] as const,
  about: ["about"] as const,
  thumbnailCache: ["thumbnail-cache"] as const,
  remembered: ["remembered-data"] as const,
};

export function fetchAppSettings(signal?: AbortSignal): Promise<AppSettingsResponse> {
  return requestJson<AppSettingsResponse>("/api/settings", { signal });
}

export function saveAppSettings(update: AppSettingsUpdate): Promise<AppSettingsResponse> {
  return putJson<AppSettingsResponse>("/api/settings", update);
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
