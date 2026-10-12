import { gifFrameUrl, mediaUrl, thumbnailUrl } from "@/features/gallery/api/media";
import type { GalleryItem } from "@/shared/types";

const GALLERY_THUMBNAIL_WIDTH = 400;
/** The server's widest thumbnail; the viewer stretches an audio waveform across its stage. */
const VIEWER_WAVEFORM_WIDTH = 1200;

type MediaSource = Pick<GalleryItem, "path" | "modified_at" | "size">;
type ThumbnailSource = MediaSource & Pick<GalleryItem, "media_type">;

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
  epoch = 0,
): string {
  const cacheKey = mediaCacheKey(modifiedAt, size);
  const withEpoch = epoch ? [cacheKey, epoch].filter(Boolean).join(".") : cacheKey;
  return thumbnailUrl(path, GALLERY_THUMBNAIL_WIDTH, withEpoch);
}

export function galleryItemThumbnailPreviewUrl(item: MediaSource, epoch = 0): string {
  return galleryThumbnailPreviewUrl(item.path, item.modified_at, item.size, epoch);
}

export function galleryItemMediaUrl(item: MediaSource): string {
  return mediaUrl(item.path, mediaCacheKey(item.modified_at, item.size));
}

export function galleryItemWaveformUrl(item: MediaSource): string {
  return thumbnailUrl(item.path, VIEWER_WAVEFORM_WIDTH, mediaCacheKey(item.modified_at, item.size));
}

/** Only an image's own file can stand in for its thumbnail in an `<img>`. */
export function galleryItemThumbnailFallbackUrl(item: ThumbnailSource): string | undefined {
  return item.media_type === "video" || item.media_type === "audio"
    ? undefined
    : galleryItemMediaUrl(item);
}

export function galleryItemGifFrameUrl(item: MediaSource, frame: number): string {
  return gifFrameUrl(item.path, frame, mediaCacheKey(item.modified_at, item.size));
}
