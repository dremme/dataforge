import { requestJson } from "./http";
import type { MediaMovePreviewResponse, MediaMoveResponse } from "../types";

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

export type MoveSelectedMediaResult = {
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

export function mediaUrl(mediaPath: string): string {
  const params = new URLSearchParams({ path: mediaPath });
  return `/api/media?${params}`;
}

export async function previewMediaMove(
  destinationFolder: string,
  paths: readonly string[],
): Promise<MediaMovePreviewResponse> {
  const params = new URLSearchParams({ destination: destinationFolder });
  return requestJson<MediaMovePreviewResponse>(`/api/media/move/preview?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}

export async function moveSelectedMedia(
  destinationFolder: string,
  paths: readonly string[],
  overwrite = false,
): Promise<MoveSelectedMediaResult> {
  const params = new URLSearchParams({
    destination: destinationFolder,
    overwrite: String(overwrite),
  });

  const response = await requestJson<MediaMoveResponse>(`/api/media/move?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });

  return {
    succeeded: response.moved.map((entry) => entry.source),
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
