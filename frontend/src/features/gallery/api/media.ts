import { postJson, requestJson } from "@/shared/api/http";
import type { MediaTransferPreviewResponse, MediaTransferResponse } from "@/shared/types";

/** Move takes the files, copy leaves the originals in place. */
export type MediaTransferMode = "move" | "copy";

export type MediaDeleteResponse = {
  path: string;
  deleted: string[];
};

export type MediaOpenResponse = {
  path: string;
};

export async function openMediaInViewer(mediaPath: string): Promise<MediaOpenResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<MediaOpenResponse>(`/api/media/open?${params}`, { method: "POST" });
}

export async function deleteMedia(mediaPath: string): Promise<MediaDeleteResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<MediaDeleteResponse>(`/api/media?${params}`, { method: "DELETE" });
}

export type DeleteSelectedMediaResult = {
  succeeded: string[];
  failed: Array<{ path: string; error: unknown }>;
};

export type TransferSelectedMediaResult = {
  succeeded: string[];
  skipped: string[];
  failed: Array<{ path: string; error: unknown }>;
};

export async function deleteSelectedMedia(
  paths: readonly string[],
): Promise<DeleteSelectedMediaResult> {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        await deleteMedia(path);
        return { path, ok: true as const };
      } catch (error) {
        return { path, ok: false as const, error };
      }
    }),
  );

  const succeeded: string[] = [];
  const failed: Array<{ path: string; error: unknown }> = [];

  for (const result of results) {
    if (result.ok) {
      succeeded.push(result.path);
    } else {
      failed.push({ path: result.path, error: result.error });
    }
  }

  return { succeeded, failed };
}

export function mediaUrl(mediaPath: string, cacheKey?: string): string {
  const params = new URLSearchParams({ path: mediaPath });
  // Without a token the browser may hold a rewritten file's old bytes: the
  // response has no max-age, so it falls back to heuristic freshness.
  if (cacheKey) {
    params.set("v", cacheKey);
  }
  return `/api/media?${params}`;
}

/**
 * Marks a URL whose file may legitimately be gone by the time it is requested.
 *
 * The browser logs a failed `<img>` load itself, and no JavaScript handler can
 * suppress it, so a caller that expects misses would spam the console. The flag
 * asks the API for a silent 204 instead; `onError` still fires either way.
 */
function asOptional(url: string): string {
  return `${url}&optional=1`;
}

export function optionalMediaUrl(mediaPath: string, cacheKey?: string): string {
  return asOptional(mediaUrl(mediaPath, cacheKey));
}

export function optionalThumbnailUrl(mediaPath: string, width?: number, cacheKey?: string): string {
  return asOptional(thumbnailUrl(mediaPath, width, cacheKey));
}

export async function previewMediaTransfer(
  mode: MediaTransferMode,
  destinationFolder: string,
  paths: readonly string[],
): Promise<MediaTransferPreviewResponse> {
  const params = new URLSearchParams({ destination: destinationFolder });
  return postJson<MediaTransferPreviewResponse>(`/api/media/${mode}/preview?${params}`, { paths });
}

export async function transferSelectedMedia(
  mode: MediaTransferMode,
  destinationFolder: string,
  paths: readonly string[],
  overwrite = false,
): Promise<TransferSelectedMediaResult> {
  const params = new URLSearchParams({
    destination: destinationFolder,
    overwrite: String(overwrite),
  });

  const response = await postJson<MediaTransferResponse>(`/api/media/${mode}?${params}`, { paths });

  return {
    succeeded: response.transferred.map((entry) => entry.source),
    skipped: response.skipped,
    failed: response.failed.map((entry) => ({ path: entry.path, error: entry.detail })),
  };
}

export function thumbnailUrl(mediaPath: string, width = 400, cacheKey?: string): string {
  const params = new URLSearchParams({
    path: mediaPath,
    w: String(width),
  });
  if (cacheKey) {
    params.set("v", cacheKey);
  }
  return `/api/thumbnail?${params}`;
}
