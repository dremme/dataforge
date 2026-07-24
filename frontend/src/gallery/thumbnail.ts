import { thumbnailUrl } from "../api";
import type { GalleryItem } from "../types";

/** Matches backend DEFAULT_THUMBNAIL_WIDTH — sized for ~280px cards at 1.4x DPR. */
export const GALLERY_THUMBNAIL_WIDTH = 400;

export function thumbnailCacheKey(modifiedAt?: string, size?: number): string | undefined {
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
  modifiedAt?: string,
  size?: number,
): string {
  const cacheKey = thumbnailCacheKey(modifiedAt, size);
  return thumbnailUrl(path, GALLERY_THUMBNAIL_WIDTH, cacheKey);
}

export function galleryItemThumbnailPreviewUrl(
  item: Pick<GalleryItem, "path" | "modified_at" | "size">,
): string {
  return galleryThumbnailPreviewUrl(item.path, item.modified_at, item.size);
}
