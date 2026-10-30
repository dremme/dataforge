import { useEffect, useRef, useState } from "react";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import { useGalleryCardMedia } from "@/features/gallery/hooks/useGalleryCardMedia";
import { iconAudioLines, iconFileImage, iconImage, iconVideo, type AppIcon } from "@/shared/icons";
import type { GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { AudioWaveform } from "./AudioWaveform";

const PREVIEW_PLAYBACK_RATE = 2;

type MediaItem = Pick<GalleryItem, "path" | "modified_at" | "size" | "media_type" | "name">;

const PLACEHOLDER_ICONS: Record<GalleryItem["media_type"], AppIcon> = {
  image: iconImage,
  gif: iconFileImage,
  video: iconVideo,
  audio: iconAudioLines,
};

interface GalleryCardMediaProps {
  item: MediaItem;
  previewing?: boolean;
}

export function GalleryCardMedia({ item, previewing = false }: GalleryCardMediaProps) {
  const itemIsVideo = item.media_type === "video";
  const itemIsGif = item.media_type === "gif";
  const itemIsMotion = itemIsVideo || itemIsGif;
  const itemIsAudio = item.media_type === "audio";
  const { containerRef, imageRef, showImage, ready, src, handleReady, handleError } =
    useGalleryCardMedia(item);
  // The store only reports a source once its own preload has decoded it, so a mask needs no onLoad.
  const painted = showImage && (ready || itemIsAudio);

  return (
    <div ref={containerRef} className="card__media-surface" aria-hidden="true">
      {!painted && (
        <div className="card__media-placeholder">
          <Icon
            icon={PLACEHOLDER_ICONS[item.media_type]}
            className="card__media-placeholder-icon"
          />
        </div>
      )}
      {showImage && itemIsAudio && <AudioWaveform src={src!} className="card__waveform" />}
      {showImage && !itemIsAudio && (
        <img
          ref={imageRef}
          className={classNames(
            "card__img",
            ready && "card__img--ready",
            itemIsMotion && "card__video",
            ready && itemIsMotion && "card__video--ready",
          )}
          src={src}
          alt=""
          decoding="async"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onLoad={handleReady}
          onError={handleError}
        />
      )}
      {previewing && itemIsVideo && <CardVideoPreview item={item} />}
    </div>
  );
}

function CardVideoPreview({ item }: { item: MediaItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const src = galleryItemMediaUrl(item);

  // The effect owns src: the cleanup strips it, and a JSX prop would not put it back on replay.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // React does not reliably reflect `muted`, and autoplay is only allowed when it is set.
    video.muted = true;
    // Loading a source resets playbackRate to the default, so the default carries the speed.
    video.defaultPlaybackRate = PREVIEW_PLAYBACK_RATE;
    video.playbackRate = PREVIEW_PLAYBACK_RATE;
    video.src = src;
    video.play()?.catch(() => {});

    return () => {
      // Unmounting alone lets the in-flight range request finish in the background.
      video.pause();
      video.removeAttribute("src");
      video.load();
      setPlaying(false);
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={classNames("card__video-preview", playing && "card__video-preview--ready")}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      onPlaying={() => setPlaying(true)}
    />
  );
}
