import { requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import type {
  AutoAdjustResponse,
  ImageEditResponse,
  ImageEditSpec,
  ImageEditStateResponse,
} from "@/shared/types";

/** Unversioned: backup bytes never change; the server sends no-cache, must-revalidate. */
export function imageOriginalUrl(mediaPath: string): string {
  return `${mediaUrl(mediaPath)}&original=1`;
}

export async function fetchImageEditState(mediaPath: string): Promise<ImageEditStateResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<ImageEditStateResponse>(`/api/media/image-edit?${params}`);
}

export async function applyImageEdit(
  mediaPath: string,
  spec: ImageEditSpec,
): Promise<ImageEditResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<ImageEditResponse>(`/api/media/image-edit?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

/** The draft rides along: the wand reads only what its crop keeps and its masks leave. */
export async function fetchImageAutoAdjust(
  mediaPath: string,
  spec: ImageEditSpec,
): Promise<AutoAdjustResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<AutoAdjustResponse>(`/api/media/image-edit/auto?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

export async function revertImageEdit(mediaPath: string): Promise<ImageEditResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<ImageEditResponse>(`/api/media/image-edit/revert?${params}`, {
    method: "POST",
  });
}
