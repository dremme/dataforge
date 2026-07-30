import { useEffect, useMemo, useState } from "react";
import {
  galleryItemMediaUrl,
  galleryItemThumbnailPreviewUrl,
} from "@/features/gallery/lib/thumbnail";
import { useGalleryCardMedia } from "@/features/gallery/hooks/useGalleryCardMedia";
import { iconImage, iconVideo } from "@/shared/icons";
import type { GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface GalleryCardMediaProps {
  item: Pick<GalleryItem, "path" | "modified_at" | "size" | "media_type" | "name">;
}

export function GalleryCardMedia({ item }: GalleryCardMediaProps) {
  const itemIsVideo = item.media_type === "video";
  const [useFullMediaFallback, setUseFullMediaFallback] = useState(false);
  const [thumbnailUnavailable, setThumbnailUnavailable] = useState(false);

  const thumbnailPreviewUrl = useMemo(() => galleryItemThumbnailPreviewUrl(item), [item]);

  const previewUrl = useFullMediaFallback ? galleryItemMediaUrl(item) : thumbnailPreviewUrl;

  const { containerRef, imageRef, showImage, ready, srcReady, handleReady } = useGalleryCardMedia(
    item.path,
    previewUrl,
  );

  // A new revision of the file deserves a fresh thumbnail attempt: the miss that
  // forced the fallback is often just the previous revision being mid-write.
  useEffect(() => {
    setUseFullMediaFallback(false);
    setThumbnailUnavailable(false);
  }, [item.path, item.modified_at, item.size]);

  if (itemIsVideo && thumbnailUnavailable) {
    return (
      <div ref={containerRef} className="card__media-surface" aria-hidden="true">
        <div className="card__media-placeholder">
          <Icon icon={iconVideo} className="card__media-placeholder-icon" />
        </div>
      </div>
    );
  }

  const handlePreviewError = () => {
    if (!useFullMediaFallback && !itemIsVideo) {
      setUseFullMediaFallback(true);
      return;
    }

    if (itemIsVideo) {
      setThumbnailUnavailable(true);
    }

    handleReady();
  };

  return (
    <div ref={containerRef} className="card__media-surface" aria-hidden="true">
      {(!showImage || !ready) && (
        <div className="card__media-placeholder">
          <Icon
            icon={itemIsVideo ? iconVideo : iconImage}
            className="card__media-placeholder-icon"
          />
        </div>
      )}
      {showImage && (
        <img
          ref={imageRef}
          className={classNames(
            "card__img",
            ready && "card__img--ready",
            itemIsVideo && "card__video",
            ready && itemIsVideo && "card__video--ready",
          )}
          src={srcReady ? previewUrl : undefined}
          alt=""
          decoding="async"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onLoad={handleReady}
          onError={handlePreviewError}
        />
      )}
    </div>
  );
}
