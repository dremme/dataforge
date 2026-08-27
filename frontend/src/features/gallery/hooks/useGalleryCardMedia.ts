import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isMediaPathWarmed,
  isPreviewLoadPending,
  requestPreviewLoad,
  subscribePreviewSettled,
} from "@/features/gallery/lib/previewLoader";
import {
  GALLERY_MEDIA_KEEP_MARGIN_PX,
  getGalleryMediaZones,
  getGalleryScrollRoot,
  type GalleryMediaZones,
} from "@/features/gallery/lib/scrollRoot";

const HIDDEN_ZONES: GalleryMediaZones = {
  shouldLoad: false,
  shouldKeep: false,
  priority: "hidden",
};

const MAX_PREVIEW_ATTEMPTS = 2;

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
  const [loadDirectly, setLoadDirectly] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const attemptsRef = useRef(0);

  useEffect(() => {
    attemptsRef.current = 0;
    setRetryToken(0);
    setLoadDirectly(false);
    setReady(isMediaPathWarmed(path));

    return subscribePreviewSettled(path, (outcome) => {
      if (outcome === "loaded") {
        setReady(true);
        return;
      }

      attemptsRef.current += 1;

      // Failed or cancelled too often: hand the URL over, or the <img> error fallback never runs.
      if (outcome === "failed" || attemptsRef.current >= MAX_PREVIEW_ATTEMPTS) {
        setLoadDirectly(true);
        return;
      }

      setRetryToken((token) => token + 1);
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
    if (loadDirectly || !zones.shouldLoad || isPreviewLoadPending(path)) return;

    requestPreviewLoad(path, previewUrl, zones.priority);
  }, [loadDirectly, path, previewUrl, retryToken, zones.priority, zones.shouldLoad]);

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
    srcReady: ready || loadDirectly,
    handleReady,
  };
}
