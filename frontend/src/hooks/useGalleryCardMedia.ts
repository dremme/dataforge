import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isMediaPathWarmed,
  isPreviewLoadPending,
  requestPreviewLoad,
  subscribePreviewReady,
} from "../gallery/previewLoader";
import {
  GALLERY_MEDIA_KEEP_MARGIN_PX,
  getGalleryMediaZones,
  getGalleryScrollRoot,
  type GalleryMediaZones,
} from "../gallery/scrollRoot";

const HIDDEN_ZONES: GalleryMediaZones = {
  shouldLoad: false,
  shouldKeep: false,
  priority: "hidden",
};

function syncImageReadyState(image: HTMLImageElement | null, onReady: () => void): void {
  if (!image || !image.complete) {
    return;
  }

  if (image.naturalWidth > 0) {
    onReady();
  }
}

export function useGalleryCardMedia(path: string, previewUrl: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zones, setZones] = useState<GalleryMediaZones>(HIDDEN_ZONES);
  const [ready, setReady] = useState(() => isMediaPathWarmed(path));

  useEffect(() => {
    setReady(isMediaPathWarmed(path));
    return subscribePreviewReady(path, () => {
      setReady(true);
    });
  }, [path]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const root = getGalleryScrollRoot() ?? element.closest("main");
    const syncZones = (isIntersectingHint?: boolean) => {
      setZones(getGalleryMediaZones(element, root, isIntersectingHint));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === element) {
            syncZones(entry.isIntersecting);
          }
        }
      },
      {
        root,
        rootMargin: `${GALLERY_MEDIA_KEEP_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );

    syncZones();
    observer.observe(element);

    const syncAfterLayout = requestAnimationFrame(() => {
      syncZones();
    });

    return () => {
      cancelAnimationFrame(syncAfterLayout);
      observer.disconnect();
    };
  }, [path]);

  useEffect(() => {
    if (!zones.shouldLoad || isPreviewLoadPending(path)) return;

    requestPreviewLoad(path, previewUrl, zones.priority);
  }, [path, previewUrl, zones.priority, zones.shouldLoad]);

  const showImage = zones.shouldLoad || (zones.shouldKeep && ready);

  const handleReady = useCallback(() => {
    setReady(true);
  }, []);

  useLayoutEffect(() => {
    if (!showImage) return;
    syncImageReadyState(imageRef.current, handleReady);
  }, [handleReady, showImage, previewUrl]);

  return {
    containerRef,
    imageRef,
    showImage,
    ready,
    handleReady,
  };
}
