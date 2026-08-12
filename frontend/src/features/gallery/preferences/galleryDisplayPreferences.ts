import { normalizeFolderPath } from "@/features/folder/lib/folderPath";
import {
  DEFAULT_DISPLAY_MODE,
  isGalleryDisplayMode,
  parseDisplayMode,
} from "@/features/gallery/lib/displayMode";
import { putJson, requestJson } from "@/shared/api/http";
import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";
import { withRetry } from "@/shared/lib/retry";
import type {
  GalleryDisplayMode,
  GalleryDisplaySettingsResponse,
  GalleryDisplaySettingsUpdate,
} from "@/shared/types";

const CACHE_KEY = "gallery-display-modes";
/**
 * The mirror only exists to paint the right layout before the request lands, so
 * it is bounded: folders past this many fall out oldest-first rather than
 * growing a localStorage entry without limit.
 */
const CACHE_LIMIT = 50;

type ModeCache = Record<string, GalleryDisplayMode>;

function cacheKeyFor(folderPath: string): string {
  return normalizeFolderPath(folderPath).toLowerCase();
}

function parseCache(value: unknown): ModeCache | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const entries = Object.entries(value).filter((entry): entry is [string, GalleryDisplayMode] =>
    isGalleryDisplayMode(entry[1]),
  );
  return Object.fromEntries(entries);
}

function readCache(): ModeCache {
  return readStoredJson<ModeCache>(CACHE_KEY, parseCache, {});
}

/** The cached mode for a folder, or `null` when this folder has not been seen. */
export function readCachedDisplayMode(folderPath: string | undefined): GalleryDisplayMode | null {
  if (!folderPath) return null;
  return readCache()[cacheKeyFor(folderPath)] ?? null;
}

function cacheDisplayMode(folderPath: string, mode: GalleryDisplayMode): void {
  const key = cacheKeyFor(folderPath);
  const cache = readCache();
  // Re-inserting moves the folder to the end, so the trim below drops the least
  // recently chosen rather than whichever happened to be written first.
  delete cache[key];
  cache[key] = mode;

  const keys = Object.keys(cache);
  for (const stale of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) {
    delete cache[stale];
  }

  writeStoredJson(CACHE_KEY, cache);
}

async function fetchDisplayMode(folderPath: string): Promise<GalleryDisplayMode> {
  const params = new URLSearchParams({ path: folderPath });
  const data = await requestJson<GalleryDisplaySettingsResponse>(
    `/api/preferences/gallery-display?${params}`,
  );
  const mode = parseDisplayMode(data.mode);
  cacheDisplayMode(folderPath, mode);
  return mode;
}

/** Never throws: an unreachable backend falls back to the cache, then the default. */
export async function loadGalleryDisplayMode(folderPath: string): Promise<GalleryDisplayMode> {
  try {
    return await withRetry(() => fetchDisplayMode(folderPath));
  } catch {
    return readCachedDisplayMode(folderPath) ?? DEFAULT_DISPLAY_MODE;
  }
}

export async function updateGalleryDisplayMode(
  folderPath: string,
  mode: GalleryDisplayMode,
): Promise<GalleryDisplayMode> {
  cacheDisplayMode(folderPath, mode);

  const body: GalleryDisplaySettingsUpdate = { mode, folder_path: folderPath };
  const data = await putJson<GalleryDisplaySettingsResponse>(
    "/api/preferences/gallery-display",
    body,
  );
  const saved = parseDisplayMode(data.mode);
  cacheDisplayMode(folderPath, saved);
  return saved;
}
