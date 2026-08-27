import { requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import { serverEventsTabId } from "@/shared/api/eventStream";
import type { VideoEditResponse, VideoEditSpec, VideoEditStateResponse } from "@/shared/types";

/** Original the editor plays; a spec is against it, so a trimmed render misplaces handles. */
export function videoOriginalUrl(mediaPath: string, cacheKey?: string): string {
  return `${mediaUrl(mediaPath, cacheKey)}&original=1`;
}

export async function fetchVideoEditState(mediaPath: string): Promise<VideoEditStateResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<VideoEditStateResponse>(`/api/media/video-edit?${params}`);
}

export async function applyVideoEdit(
  mediaPath: string,
  spec: VideoEditSpec,
): Promise<VideoEditResponse> {
  const params = new URLSearchParams({ path: mediaPath, tab: serverEventsTabId() });
  return requestJson<VideoEditResponse>(`/api/media/video-edit?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

export async function cancelVideoEdit(mediaPath: string): Promise<void> {
  const params = new URLSearchParams({ path: mediaPath });
  await fetch(`/api/media/video-edit/cancel?${params}`, { method: "POST" });
}

export async function revertVideoEdit(mediaPath: string): Promise<VideoEditResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<VideoEditResponse>(`/api/media/video-edit/revert?${params}`, {
    method: "POST",
  });
}
