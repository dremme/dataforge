import { useEffect, useMemo, useRef, useState } from "react";
import {
  galleryItemMediaUrl,
  galleryItemThumbnailPreviewUrl,
} from "@/features/gallery/lib/thumbnail";
import { useGalleryCardMedia } from "@/features/gallery/hooks/useGalleryCardMedia";
import { iconFileImage, iconImage, iconVideo } from "@/shared/icons";
import type { GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

type MediaItem = Pick<GalleryItem, "path" | "modified_at" | "size" | "media_type" | "name">;

const THUMBNAIL_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

interface GalleryCardMediaProps {
  item: MediaItem;
  previewing?: boolean;
  onPreviewPlaying?: (playing: boolean) => void;
}

export function GalleryCardMedia({
  item,
  previewing = false,
  onPreviewPlaying,
}: GalleryCardMediaProps) {
  const itemIsVideo = item.media_type === "video";
  const itemIsGif = item.media_type === "gif";
  const itemIsMotion = itemIsVideo || itemIsGif;
  const [useFullMediaFallback, setUseFullMediaFallback] = useState(false);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  const thumbnailPreviewUrl = useMemo(() => galleryItemThumbnailPreviewUrl(item), [item]);

  const retryUrl = retryAttempt
    ? `${thumbnailPreviewUrl}&retry=${retryAttempt}`
    : thumbnailPreviewUrl;
  const previewUrl = useFullMediaFallback ? galleryItemMediaUrl(item) : retryUrl;

  const { containerRef, imageRef, shouldLoad, showImage, ready, srcReady, handleReady } =
    useGalleryCardMedia(item.path, previewUrl);

  useEffect(() => {
    setUseFullMediaFallback(false);
    setMediaUnavailable(false);
    setRetryAttempt(0);
  }, [item.path, item.modified_at, item.size]);

  useEffect(() => {
    const delay = THUMBNAIL_RETRY_DELAYS_MS[retryAttempt];
    if (!shouldLoad || !mediaUnavailable || delay === undefined) return;

    const timer = window.setTimeout(() => {
      setRetryAttempt((attempt) => attempt + 1);
      setUseFullMediaFallback(false);
      setMediaUnavailable(false);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [mediaUnavailable, retryAttempt, shouldLoad, thumbnailPreviewUrl]);

  // A GIF can fall back to the full file in an <img>; an MP4 cannot.
  const handlePreviewError = () => {
    if (!useFullMediaFallback && !itemIsVideo) {
      setUseFullMediaFallback(true);
      return;
    }

    setMediaUnavailable(true);
  };

  return (
    <div ref={containerRef} className="card__media-surface" aria-hidden="true">
      {(mediaUnavailable || !showImage || !ready) && (
        <div className="card__media-placeholder">
          <Icon
            icon={itemIsGif ? iconFileImage : itemIsVideo ? iconVideo : iconImage}
            className="card__media-placeholder-icon"
          />
        </div>
      )}
      {showImage && !mediaUnavailable && (
        <img
          ref={imageRef}
          className={classNames(
            "card__img",
            ready && "card__img--ready",
            itemIsMotion && "card__video",
            ready && itemIsMotion && "card__video--ready",
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
      {previewing && itemIsVideo && <CardVideoPreview item={item} onPlaying={onPreviewPlaying} />}
    </div>
  );
}

function CardVideoPreview({
  item,
  onPlaying,
}: {
  item: MediaItem;
  onPlaying?: (playing: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const src = galleryItemMediaUrl(item);

  // The effect owns src: the cleanup strips it, and a JSX prop would not put it back on replay.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // React does not reliably reflect `muted`, and autoplay is only allowed when it is set.
    video.muted = true;
    video.src = src;
    video.play()?.catch(() => {});

    return () => {
      // Unmounting alone lets the in-flight range request finish in the background.
      video.pause();
      video.removeAttribute("src");
      video.load();
      setPlaying(false);
      onPlaying?.(false);
    };
  }, [onPlaying, src]);

  return (
    <video
      ref={videoRef}
      className={classNames("card__video-preview", playing && "card__video-preview--ready")}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      onPlaying={() => {
        setPlaying(true);
        onPlaying?.(true);
      }}
    />
  );
}
