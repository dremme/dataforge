import { useEffect, useMemo, useState } from "react";
import { mediaUrl } from "../api";
import { galleryItemThumbnailPreviewUrl } from "../gallery/thumbnail";
import { useGalleryCardMedia } from "../hooks/useGalleryCardMedia";
import { iconImage, iconVideo } from "../icons";
import type { GalleryItem } from "../types";
import { classNames } from "../utils/classNames";
import { Icon } from "./Icon";

interface GalleryCardMediaProps {
  item: Pick<GalleryItem, "path" | "modified_at" | "size" | "media_type" | "name">;
}

export function GalleryCardMedia({ item }: GalleryCardMediaProps) {
  const itemIsVideo = item.media_type === "video";
  const [useFullMediaFallback, setUseFullMediaFallback] = useState(false);
  const [thumbnailUnavailable, setThumbnailUnavailable] = useState(false);

  const thumbnailPreviewUrl = useMemo(() => galleryItemThumbnailPreviewUrl(item), [item]);

  const previewUrl = useFullMediaFallback ? mediaUrl(item.path) : thumbnailPreviewUrl;

  const { containerRef, imageRef, showImage, ready, handleReady } = useGalleryCardMedia(
    item.path,
    previewUrl,
  );

  useEffect(() => {
    setUseFullMediaFallback(false);
    setThumbnailUnavailable(false);
  }, [item.path]);

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
          src={ready ? previewUrl : undefined}
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
