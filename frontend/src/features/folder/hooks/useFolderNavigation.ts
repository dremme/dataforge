import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFolderFingerprint } from "@/features/folder/api/folderContents";
import { buildBreadcrumbs } from "@/features/folder/lib/breadcrumbs";
import { evictCachedFolder, readCachedFolder } from "@/features/folder/lib/folderCache";
import {
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
  type HistoryMode,
} from "@/features/folder/lib/folderHistory";
import { getCachedLastFolder, loadFolderContents } from "@/features/folder/lib/folderPreferences";
import { isAbortError, resolveFolderError, type FolderError } from "@/shared/api/http";
import type { FolderResponse } from "@/shared/types";

/**
 * Whether a cached payload is still current, via the cheap fingerprint endpoint.
 *
 * Saves refetching a whole folder to discover nothing moved. Any doubt — a
 * missing fingerprint, a failed check — answers `false` so the caller does the
 * full load rather than trusting stale content.
 */
async function isFolderUnchanged(cached: FolderResponse, signal: AbortSignal): Promise<boolean> {
  if (!cached.fingerprint) return false;

  try {
    const { fingerprint } = await fetchFolderFingerprint(cached.path, signal);
    return fingerprint === cached.fingerprint;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  }
}

function applyOptimisticFolder(folder: FolderResponse, folderPath: string): FolderResponse {
  return {
    ...folder,
    path: folderPath,
    breadcrumbs: buildBreadcrumbs(folderPath),
  };
}

function createFailedFolderShell(
  folderPath: string,
  previousFolder: FolderResponse | null,
): FolderResponse {
  const breadcrumbs = buildBreadcrumbs(folderPath);
  const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].path : null;

  return {
    path: folderPath,
    home: previousFolder?.home ?? folderPath,
    parent,
    breadcrumbs,
    subfolders: [],
    items: [],
    sysprompt: null,
    has_caption_backup: false,
    item_count: 0,
    subfolder_count: 0,
    fingerprint: "",
  };
}

export type LoadFolderOptions = {
  preserveSelection?: boolean;
  updateRecent?: boolean;
  /** Keep folder content visible and only show lightweight refresh affordances. */
  silent?: boolean;
};

export type ReloadFolderOptions = Pick<LoadFolderOptions, "silent">;

export function useFolderNavigation(onFolderChange?: () => void) {
  const [folder, setFolder] = useState<FolderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<FolderError | null>(null);
  const initialLoadDone = useRef(false);
  const loadGenerationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);
  const lastRequestedPathRef = useRef<string | undefined>(undefined);

  const loadFolder = useCallback(
    async (
      path?: string,
      { preserveSelection = false, updateRecent = true, silent = false }: LoadFolderOptions = {},
    ) => {
      lastRequestedPathRef.current = path;
      const generation = ++loadGenerationRef.current;
      setError(null);

      // Drop the superseded request rather than parsing a payload we discard.
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      // A folder we already hold can paint now and revalidate underneath, so
      // only an uncached one is worth blanking the grid for. Silent reloads opt
      // out: the caller already has content up and is asking for fresh data, so
      // replaying a cached payload would only flash something staler.
      const cached = silent ? null : readCachedFolder(path);
      const showSkeleton = !silent && !cached;

      if (cached) {
        setFolder(cached);
      }

      if (showSkeleton) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      if (!silent && !preserveSelection) {
        onFolderChange?.();
      }

      try {
        if (cached && (await isFolderUnchanged(cached, controller.signal))) {
          return cached;
        }

        const data = await loadFolderContents(path, { updateRecent, signal: controller.signal });
        if (generation !== loadGenerationRef.current) {
          return null;
        }
        setFolder(data);
        return data;
      } catch (err) {
        if (generation !== loadGenerationRef.current || isAbortError(err)) {
          return null;
        }
        const resolved = resolveFolderError(err);
        if (resolved?.kind === "folder-not-found") {
          evictCachedFolder(path);
          setFolder((current) => {
            const folderPath =
              path ?? current?.path ?? lastRequestedPathRef.current ?? getCachedLastFolder();
            if (!folderPath) {
              return null;
            }
            return createFailedFolderShell(folderPath, current);
          });
        } else if (!silent) {
          setFolder(null);
        }
        setError(resolved);
        return null;
      } finally {
        if (generation === loadGenerationRef.current) {
          if (showSkeleton) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [onFolderChange],
  );

  const navigateTo = useCallback(
    async (path?: string, historyMode: HistoryMode = "push") => {
      if (historyMode === "push" && path && folder?.path === path) return;

      if (path) {
        setFolder((current) =>
          current ? applyOptimisticFolder(current, path) : createFailedFolderShell(path, null),
        );
        if (historyMode !== "none") {
          syncFolderHistory(path, historyMode);
        }
      }

      const data = await loadFolder(path);
      if (data && path && historyMode !== "none" && data.path !== path) {
        syncFolderHistory(data.path, "replace");
      }
    },
    [folder?.path, loadFolder],
  );

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const initialPath = getFolderFromUrl();
    loadFolder(initialPath).then((data) => {
      if (data) {
        syncFolderHistory(data.path, "replace");
      }
    });
  }, [loadFolder]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const path = getFolderFromHistoryEvent(event);
      syncFolderHistory(path, "none");

      if (path) {
        setFolder((current) =>
          current ? applyOptimisticFolder(current, path) : createFailedFolderShell(path, null),
        );
      }

      void loadFolder(path);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadFolder]);

  const reloadFolder = useCallback(
    async ({ silent = true }: ReloadFolderOptions = {}) => {
      if (!folder?.path) return null;
      return loadFolder(folder.path, {
        preserveSelection: true,
        updateRecent: false,
        silent,
      });
    },
    [folder?.path, loadFolder],
  );

  return { folder, loading, refreshing, error, reloadFolder, navigateTo, setFolder };
}
