import { gifFrameUrl, mediaUrl, thumbnailUrl } from "@/features/gallery/api/media";
import type { GalleryItem } from "@/shared/types";

const GALLERY_THUMBNAIL_WIDTH = 400;

type MediaSource = Pick<GalleryItem, "path" | "modified_at" | "size">;

/** Version token so an in-place edit (same path) is never served from cache. */
export function mediaCacheKey(
  modifiedAt?: string | null,
  size?: number | null,
): string | undefined {
  if (!modifiedAt) {
    return size == null ? undefined : String(size);
  }

  const timestamp = Date.parse(modifiedAt);
  if (Number.isNaN(timestamp)) {
    return size == null ? modifiedAt : `${modifiedAt}:${size}`;
  }

  return size == null ? String(timestamp) : `${timestamp}-${size}`;
}

export function galleryThumbnailPreviewUrl(
  path: string,
  modifiedAt?: string | null,
  size?: number | null,
): string {
  const cacheKey = mediaCacheKey(modifiedAt, size);
  return thumbnailUrl(path, GALLERY_THUMBNAIL_WIDTH, cacheKey);
}

export function galleryItemThumbnailPreviewUrl(item: MediaSource): string {
  return galleryThumbnailPreviewUrl(item.path, item.modified_at, item.size);
}

export function galleryItemMediaUrl(item: MediaSource): string {
  return mediaUrl(item.path, mediaCacheKey(item.modified_at, item.size));
}

export function galleryItemGifFrameUrl(item: MediaSource, frame: number): string {
  return gifFrameUrl(item.path, frame, mediaCacheKey(item.modified_at, item.size));
}
