import { requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import { serverEventsTabId } from "@/shared/api/eventStream";
import { emptyDraft, toVideoEditSpec } from "@/features/gallery/lib/videoEdit";
import type {
  AutoAdjustResponse,
  VideoEditResponse,
  VideoEditSpec,
  VideoEditStateResponse,
} from "@/shared/types";

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

/**
 * Re-encodes a video the browser cannot play, in place: its current edit is kept, and the
 * original stays as the edit backup, so Revert original brings the file back.
 */
export async function transcodeVideo(mediaPath: string): Promise<VideoEditResponse> {
  const { spec } = await fetchVideoEditState(mediaPath);
  return applyVideoEdit(mediaPath, {
    ...(spec ?? toVideoEditSpec(emptyDraft(0), 0)),
    transcode: true,
  });
}

/** The draft rides along: the wand reads only its trim, crop and unmasked pixels. */
export async function fetchVideoAutoAdjust(
  mediaPath: string,
  spec: VideoEditSpec,
): Promise<AutoAdjustResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<AutoAdjustResponse>(`/api/media/video-edit/auto?${params}`, {
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
