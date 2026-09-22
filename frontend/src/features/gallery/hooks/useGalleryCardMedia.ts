import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useThumbnailRuntime } from "@/features/gallery/context/thumbnailContext";
import {
  galleryItemMediaUrl,
  galleryItemThumbnailPreviewUrl,
} from "@/features/gallery/lib/thumbnail";
import { getGalleryScrollRoot } from "@/features/gallery/lib/scrollRoot";
import type { GalleryMediaZones } from "@/features/gallery/lib/scrollRoot";
import type { GalleryItem } from "@/shared/types";

export function useGalleryCardMedia(
  item: Pick<GalleryItem, "path" | "modified_at" | "size" | "media_type">,
) {
  const { store, visibility } = useThumbnailRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const consumer = useRef({});
  const [zones, setZones] = useState<GalleryMediaZones>({
    shouldLoad: false,
    shouldKeep: false,
    priority: "hidden",
  });
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const url = galleryItemThumbnailPreviewUrl(item);
  const fallbackUrl = item.media_type === "video" ? undefined : galleryItemMediaUrl(item);
  const source = useMemo(() => ({ url, fallbackUrl }), [url, fallbackUrl]);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(url, listener),
    [store, url],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(url), [store, url]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    return visibility.observe(element, getGalleryScrollRoot() ?? element.closest("main"), setZones);
  }, [visibility]);

  useLayoutEffect(() => {
    const owner = consumer.current;
    store.setDemand(
      owner,
      zones.shouldKeep || zones.shouldLoad
        ? [
            {
              ...source,
              priority: zones.shouldLoad
                ? zones.priority === "visible"
                  ? "visible"
                  : "prefetch"
                : "retain",
              recover: zones.shouldLoad,
            },
          ]
        : [],
    );
  }, [source, store, zones]);

  useLayoutEffect(() => {
    const owner = consumer.current;
    return () => store.setDemand(owner, []);
  }, [store]);

  const src = snapshot.status === "ready" ? snapshot.src : undefined;
  const showImage = Boolean(src && (zones.shouldLoad || zones.shouldKeep));
  const ready = Boolean(src && loadedSrc === src);
  const handleReady = useCallback(() => {
    const image = imageRef.current;
    if (src && image?.getAttribute("src") === src) setLoadedSrc(src);
  }, [src]);
  useLayoutEffect(() => {
    if (!showImage) {
      setLoadedSrc(undefined);
      return;
    }
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) handleReady();
  }, [showImage, handleReady]);

  const handleError = useCallback(() => {
    setLoadedSrc(undefined);
    store.reportError(url, snapshot);
  }, [store, url, snapshot]);

  return { containerRef, imageRef, showImage, ready, src, handleReady, handleError };
}
