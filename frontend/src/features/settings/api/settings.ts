import { forgetVisionModelId } from "@/features/automation/api/visionLlm";
import { putJson, requestJson } from "@/shared/api/http";
import type {
  AppSettingsResponse,
  AppSettingsUpdate,
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

export function fetchThumbnailCacheStats(signal?: AbortSignal): Promise<ThumbnailCacheStats> {
  return requestJson<ThumbnailCacheStats>("/api/thumbnails/cache", { signal });
}

export function clearThumbnailCache(): Promise<ThumbnailCacheCleared> {
  return requestJson<ThumbnailCacheCleared>("/api/thumbnails/cache", { method: "DELETE" });
}
