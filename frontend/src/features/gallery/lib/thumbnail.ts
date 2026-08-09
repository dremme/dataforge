import { gifFrameUrl, mediaUrl, thumbnailUrl } from "@/features/gallery/api/media";
import type { GalleryItem } from "@/shared/types";

/** Matches backend DEFAULT_THUMBNAIL_WIDTH — sized for ~280px cards at 1.4x DPR. */
const GALLERY_THUMBNAIL_WIDTH = 400;

type MediaSource = Pick<GalleryItem, "path" | "modified_at" | "size">;

/**
 * Version token for media URLs. Editing a file in place keeps its path, so both
 * the thumbnail and the full media URL need this to escape the browser cache.
 */
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

/** Full-size media URL, versioned so an in-place edit is never served from cache. */
export function galleryItemMediaUrl(item: MediaSource): string {
  return mediaUrl(item.path, mediaCacheKey(item.modified_at, item.size));
}

/**
 * One decoded GIF frame, versioned like the media URL above.
 *
 * The version matters more here than elsewhere: a versioned frame URL is cached
 * immutably, which is what lets the save re-read the exact bytes the scrub painted
 * instead of asking the server to decode the frame a second time.
 */
export function galleryItemGifFrameUrl(item: MediaSource, frame: number): string {
  return gifFrameUrl(item.path, frame, mediaCacheKey(item.modified_at, item.size));
}
