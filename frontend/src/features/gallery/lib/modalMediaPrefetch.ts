import { isSysPrompt, isVideo } from "@/features/gallery/lib/itemKind";
import { galleryItemMediaUrl } from "@/features/gallery/lib/thumbnail";
import type { GalleryItem } from "@/shared/types";

export type ModalMediaPrefetchTarget = {
  path: string;
  url: string;
  kind: "image" | "video";
};

export type CollectModalMediaTargetsOptions = {
  offsets?: readonly number[];
};

export function collectAdjacentModalMediaTargets(
  items: readonly GalleryItem[],
  index: number,
  options: CollectModalMediaTargetsOptions = {},
): ModalMediaPrefetchTarget[] {
  const offsets = options.offsets ?? ([-1, 1] as const);
  const targets: ModalMediaPrefetchTarget[] = [];
  const seen = new Set<string>();

  for (const offset of offsets) {
    const item = items[index + offset];
    if (!item || isSysPrompt(item) || seen.has(item.path)) continue;
    seen.add(item.path);
    targets.push({
      path: item.path,
      url: galleryItemMediaUrl(item),
      kind: isVideo(item) ? "video" : "image",
    });
  }

  return targets;
}

function setLowFetchPriority(element: HTMLElement): void {
  if ("fetchPriority" in element) {
    (element as HTMLElement & { fetchPriority: string }).fetchPriority = "low";
  }
}

function tryMediaLoad(element: HTMLMediaElement): void {
  try {
    element.load();
  } catch {
    // Ignore incomplete media implementations (e.g. some test hosts).
  }
}

function prefetchModalMedia(targets: readonly ModalMediaPrefetchTarget[]): () => void {
  const images: HTMLImageElement[] = [];
  const videos: HTMLVideoElement[] = [];

  for (const target of targets) {
    if (target.kind === "image") {
      const image = new Image();
      image.decoding = "async";
      setLowFetchPriority(image);
      image.src = target.url;
      images.push(image);
      continue;
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    setLowFetchPriority(video);
    video.src = target.url;
    tryMediaLoad(video);
    videos.push(video);
  }

  return () => {
    for (const image of images) {
      image.src = "";
    }
    for (const video of videos) {
      video.removeAttribute("src");
      tryMediaLoad(video);
    }
  };
}

export function schedulePrefetchModalMedia(
  targets: readonly ModalMediaPrefetchTarget[],
  options?: { timeoutMs?: number },
): () => void {
  if (targets.length === 0) {
    return () => {};
  }

  let cancelled = false;
  let idleHandle: number | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let stopPrefetch: (() => void) | null = null;

  const start = () => {
    if (cancelled) return;
    stopPrefetch = prefetchModalMedia(targets);
  };

  const timeoutMs = options?.timeoutMs ?? 1500;

  if (typeof requestIdleCallback === "function") {
    idleHandle = requestIdleCallback(start, { timeout: timeoutMs });
  } else {
    timeoutHandle = setTimeout(start, 0);
  }

  return () => {
    cancelled = true;
    if (idleHandle != null && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(idleHandle);
    }
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle);
    }
    stopPrefetch?.();
  };
}
