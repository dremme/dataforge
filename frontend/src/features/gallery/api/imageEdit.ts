import { requestJson } from "@/shared/api/http";
import { mediaUrl } from "@/features/gallery/api/media";
import type { ImageEditResponse, ImageEditSpec, ImageEditStateResponse } from "@/shared/types";

/**
 * The untouched original kept beside an edited image.
 *
 * The editor shows this rather than the current file: a spec is expressed against the
 * original, so a crop rectangle drawn over an already-cropped render would frame the
 * wrong pixels. Falls back to the file itself while it has never been edited.
 *
 * Deliberately unversioned. The backup's bytes never change once it exists, and the
 * server answers an unversioned media URL with `no-cache, must-revalidate`, so the one
 * URL stays correct across every apply.
 */
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
  // No tab id, unlike the video editor: a Pillow pass finishes inside this one request,
  // so there is no progress to push and nothing to address it to.
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<ImageEditResponse>(`/api/media/image-edit?${params}`, {
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
