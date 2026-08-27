import type { GalleryMediaZonePriority } from "./scrollRoot";

const MAX_WARMED_PATHS = 500;
const MAX_CONCURRENT_PREVIEWS_IDLE = 24;
const MAX_CONCURRENT_PREVIEWS_ACTIVE = 8;

const warmedMediaPaths = new Map<string, true>();

export function markMediaPathWarmed(path: string): void {
  if (warmedMediaPaths.has(path)) {
    warmedMediaPaths.delete(path);
  }
  warmedMediaPaths.set(path, true);

  while (warmedMediaPaths.size > MAX_WARMED_PATHS) {
    const oldest = warmedMediaPaths.keys().next().value;
    if (oldest) {
      warmedMediaPaths.delete(oldest);
    }
  }
}

export function isMediaPathWarmed(path: string): boolean {
  return warmedMediaPaths.has(path);
}

interface PreviewRequest {
  path: string;
  url: string;
  priority: "visible" | "prefetch";
}

interface InflightLoad {
  image: HTMLImageElement;
  priority: "visible" | "prefetch";
}

type GalleryScrollPhase = "active" | "idle";

let scrollPhase: GalleryScrollPhase = "idle";
let paused = false;
let activeCount = 0;
const visibleQueue: PreviewRequest[] = [];
const prefetchQueue: PreviewRequest[] = [];
const inflightPaths = new Set<string>();
const inflightLoads = new Map<string, InflightLoad>();
const loadedUrls = new Map<string, string>();

export type PreviewOutcome = "loaded" | "failed" | "cancelled";

const settledListeners = new Map<string, Set<(outcome: PreviewOutcome) => void>>();

function maxConcurrentPreviews(): number {
  return scrollPhase === "active" ? MAX_CONCURRENT_PREVIEWS_ACTIVE : MAX_CONCURRENT_PREVIEWS_IDLE;
}

export function setGalleryScrollPhase(phase: GalleryScrollPhase): void {
  if (scrollPhase === phase) return;

  scrollPhase = phase;
  if (phase === "active") {
    prefetchQueue.length = 0;
    abortAllInflightPrefetch();
  }

  drainQueue();
}

export function isGalleryScrollActive(): boolean {
  return scrollPhase === "active";
}

function notifySettled(path: string, outcome: PreviewOutcome): void {
  const listeners = settledListeners.get(path);
  if (!listeners) return;

  for (const listener of [...listeners]) {
    listener(outcome);
  }
}

function queueIndex(queue: PreviewRequest[], path: string): number {
  return queue.findIndex((request) => request.path === path);
}

function removeQueued(path: string): void {
  const visibleIndex = queueIndex(visibleQueue, path);
  if (visibleIndex >= 0) {
    visibleQueue.splice(visibleIndex, 1);
  }

  const prefetchIndex = queueIndex(prefetchQueue, path);
  if (prefetchIndex >= 0) {
    prefetchQueue.splice(prefetchIndex, 1);
  }
}

function enqueue(request: PreviewRequest): void {
  removeQueued(request.path);

  if (request.priority === "visible") {
    visibleQueue.unshift(request);
    return;
  }

  prefetchQueue.push(request);
}

function shouldLoad(path: string, url: string): boolean {
  if (inflightPaths.has(path)) return false;
  if (!isMediaPathWarmed(path)) return true;
  return loadedUrls.get(path) !== url;
}

export function isPreviewLoadPending(path: string): boolean {
  return inflightPaths.has(path);
}

function abortInflight(path: string): void {
  const inflight = inflightLoads.get(path);
  if (!inflight) return;

  inflight.image.onload = null;
  inflight.image.onerror = null;
  inflight.image.src = "";
  inflightLoads.delete(path);
  inflightPaths.delete(path);
  activeCount = Math.max(0, activeCount - 1);
  // Cancelling silently would strand the card with no src, so its own error fallback never runs.
  notifySettled(path, "cancelled");
}

function abortInflightPrefetch(path: string): void {
  const inflight = inflightLoads.get(path);
  if (!inflight || inflight.priority !== "prefetch") return;
  abortInflight(path);
}

function abortAllInflightPrefetch(): void {
  for (const [path, inflight] of [...inflightLoads.entries()]) {
    if (inflight.priority === "prefetch") {
      abortInflight(path);
    }
  }
}

function abortStaleInflight(
  visiblePaths: ReadonlySet<string>,
  prefetchPaths: ReadonlySet<string>,
): void {
  for (const [path, inflight] of [...inflightLoads.entries()]) {
    if (inflight.priority === "visible" && !visiblePaths.has(path)) {
      abortInflight(path);
      continue;
    }

    if (inflight.priority === "prefetch" && !prefetchPaths.has(path)) {
      abortInflight(path);
    }
  }
}

function reconcilePreviewQueues(
  visiblePaths: ReadonlySet<string>,
  prefetchPaths: ReadonlySet<string>,
): void {
  for (let index = visibleQueue.length - 1; index >= 0; index -= 1) {
    if (!visiblePaths.has(visibleQueue[index].path)) {
      visibleQueue.splice(index, 1);
    }
  }

  for (let index = prefetchQueue.length - 1; index >= 0; index -= 1) {
    if (!prefetchPaths.has(prefetchQueue[index].path)) {
      prefetchQueue.splice(index, 1);
    }
  }

  abortStaleInflight(visiblePaths, prefetchPaths);
}

function ensureRoomForVisible(): void {
  const maxConcurrent = maxConcurrentPreviews();

  while (visibleQueue.length > 0 && activeCount >= maxConcurrent) {
    let prefetchPath: string | null = null;

    for (const [path, inflight] of inflightLoads) {
      if (inflight.priority === "prefetch") {
        prefetchPath = path;
      }
    }

    if (!prefetchPath) break;
    abortInflightPrefetch(prefetchPath);
  }
}

function drainQueue(): void {
  if (paused) return;

  const maxConcurrent = maxConcurrentPreviews();

  while (activeCount < maxConcurrent) {
    const next = visibleQueue.shift() ?? prefetchQueue.shift();
    if (!next) break;
    if (!shouldLoad(next.path, next.url)) continue;

    startPreviewLoad(next);
  }
}

function startPreviewLoad(request: PreviewRequest): void {
  activeCount += 1;
  inflightPaths.add(request.path);

  const image = new Image();
  inflightLoads.set(request.path, {
    image,
    priority: request.priority,
  });

  const finish = (success: boolean) => {
    if (!inflightLoads.has(request.path)) return;

    activeCount = Math.max(0, activeCount - 1);
    inflightPaths.delete(request.path);
    inflightLoads.delete(request.path);

    if (success) {
      loadedUrls.set(request.path, request.url);
      markMediaPathWarmed(request.path);
    }

    notifySettled(request.path, success ? "loaded" : "failed");
    drainQueue();
  };

  image.decoding = "async";
  image.onload = () => finish(true);
  image.onerror = () => finish(false);
  image.src = request.url;
}

export function requestPreviewLoad(
  path: string,
  url: string,
  priority: GalleryMediaZonePriority,
): void {
  if (paused || priority === "hidden") return;
  if (!shouldLoad(path, url)) return;

  const effectivePriority = priority === "visible" ? "visible" : "prefetch";
  if (scrollPhase === "active" && effectivePriority !== "visible") {
    return;
  }

  enqueue({
    path,
    url,
    priority: effectivePriority,
  });

  if (effectivePriority === "visible") {
    ensureRoomForVisible();
  }

  drainQueue();
}

export function syncGalleryPreviewTargets(targets: readonly PreviewRequest[]): void {
  if (paused) return;

  const visiblePaths = new Set<string>();
  const prefetchPaths = new Set<string>();

  for (const target of targets) {
    if (target.priority === "visible") {
      visiblePaths.add(target.path);
      continue;
    }

    if (scrollPhase === "idle") {
      prefetchPaths.add(target.path);
    }
  }

  reconcilePreviewQueues(visiblePaths, prefetchPaths);

  for (const target of targets) {
    if (scrollPhase === "active" && target.priority !== "visible") {
      continue;
    }
    if (!shouldLoad(target.path, target.url)) {
      continue;
    }

    enqueue(target);

    if (target.priority === "visible") {
      ensureRoomForVisible();
    }
  }

  drainQueue();
}

export function subscribePreviewSettled(
  path: string,
  listener: (outcome: PreviewOutcome) => void,
): () => void {
  let listeners = settledListeners.get(path);
  if (!listeners) {
    listeners = new Set();
    settledListeners.set(path, listeners);
  }

  listeners.add(listener);
  if (isMediaPathWarmed(path)) {
    listener("loaded");
  }

  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      settledListeners.delete(path);
    }
  };
}

export function pauseGalleryPreviewLoader(): void {
  paused = true;
  visibleQueue.length = 0;
  prefetchQueue.length = 0;
}

export function resumeGalleryPreviewLoader(): void {
  if (!paused) return;

  paused = false;
  drainQueue();
}

/** @internal Test helper */
export function resetGalleryPreviewLoaderForTests(): void {
  scrollPhase = "idle";
  paused = false;
  activeCount = 0;
  visibleQueue.length = 0;
  prefetchQueue.length = 0;
  inflightPaths.clear();
  inflightLoads.clear();
  loadedUrls.clear();
  settledListeners.clear();
  warmedMediaPaths.clear();
}

/** @internal Test helper */
export function getGalleryPreviewLoaderStateForTests(): {
  paused: boolean;
  activeCount: number;
  visibleWaitCount: number;
  prefetchWaitCount: number;
  inflightCount: number;
  scrollPhase: GalleryScrollPhase;
} {
  return {
    paused,
    activeCount,
    visibleWaitCount: visibleQueue.length,
    prefetchWaitCount: prefetchQueue.length,
    inflightCount: inflightPaths.size,
    scrollPhase,
  };
}
