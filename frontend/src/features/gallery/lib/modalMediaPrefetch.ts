import { mediaUrl } from "@/features/gallery/api/media";
import { isSysPrompt, isVideo } from "@/features/gallery/lib/itemKind";
import type { GalleryItem } from "@/shared/types";

export type ModalMediaPrefetchTarget = {
  path: string;
  url: string;
  kind: "image" | "video";
};

export type CollectModalMediaTargetsOptions = {
  /** Index offsets from the current item. Default: previous and next. */
  offsets?: readonly number[];
};

/** Neighbor media relative to the open modal index (skips system prompts). */
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
      url: mediaUrl(item.path),
      kind: isVideo(item) ? "video" : "image",
    });
  }

  return targets;
}

/**
 * Warm the browser cache for modal full-size media.
 * Loads use low priority where supported so the primary stage stays snappy.
 * Returns a cleanup that aborts dangling loads.
 */
export function prefetchModalMedia(targets: readonly ModalMediaPrefetchTarget[]): () => void {
  const images: HTMLImageElement[] = [];
  const videos: HTMLVideoElement[] = [];

  for (const target of targets) {
    if (target.kind === "image") {
      const image = new Image();
      image.decoding = "async";
      // Prefer letting the current visible media claim bandwidth first.
      if ("fetchPriority" in image) {
        (image as HTMLImageElement & { fetchPriority: string }).fetchPriority = "low";
      }
      image.src = target.url;
      images.push(image);
      continue;
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    if ("fetchPriority" in video) {
      (video as HTMLVideoElement & { fetchPriority: string }).fetchPriority = "low";
    }
    video.src = target.url;
    video.load();
    videos.push(video);
  }

  return () => {
    for (const image of images) {
      image.src = "";
    }
    for (const video of videos) {
      video.removeAttribute("src");
      video.load();
    }
  };
}

/**
 * Start prefetch after the browser is idle (or a short timeout fallback) so it
 * does not compete with the primary media request. Non-blocking.
 */
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
    // Yield past the current frame so the primary <img>/<video> request starts first.
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
