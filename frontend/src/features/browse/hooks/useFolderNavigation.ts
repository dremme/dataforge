import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBrowseFingerprint } from "@/features/browse/api/browse";
import { buildBreadcrumbs } from "@/features/browse/lib/breadcrumbs";
import { evictCachedBrowse, readCachedBrowse } from "@/features/browse/lib/browseCache";
import {
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
  type HistoryMode,
} from "@/features/browse/lib/folderHistory";
import { getCachedLastFolder, loadBrowseFolder } from "@/features/browse/lib/folderPreferences";
import { isAbortError, resolveBrowseError, type BrowseError } from "@/shared/api/http";
import type { BrowseResponse } from "@/shared/types";

/**
 * Whether a cached payload is still current, via the cheap fingerprint endpoint.
 *
 * Saves refetching a whole folder to discover nothing moved. Any doubt — a
 * missing fingerprint, a failed check — answers `false` so the caller does the
 * full load rather than trusting stale content.
 */
async function isFolderUnchanged(cached: BrowseResponse, signal: AbortSignal): Promise<boolean> {
  if (!cached.fingerprint) return false;

  try {
    const { fingerprint } = await fetchBrowseFingerprint(cached.folder, signal);
    return fingerprint === cached.fingerprint;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  }
}

function applyOptimisticBrowse(browse: BrowseResponse, folderPath: string): BrowseResponse {
  return {
    ...browse,
    folder: folderPath,
    breadcrumbs: buildBreadcrumbs(folderPath),
  };
}

function createFailedBrowseShell(
  folderPath: string,
  previousBrowse: BrowseResponse | null,
): BrowseResponse {
  const breadcrumbs = buildBreadcrumbs(folderPath);
  const parent = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].path : null;

  return {
    folder: folderPath,
    home: previousBrowse?.home ?? folderPath,
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
  /** Keep browse content visible and only show lightweight refresh affordances. */
  silent?: boolean;
};

export type ReloadFolderOptions = Pick<LoadFolderOptions, "silent">;

export function useFolderNavigation(onFolderChange?: () => void) {
  const [browse, setBrowse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<BrowseError | null>(null);
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
      const cached = silent ? null : readCachedBrowse(path);
      const showSkeleton = !silent && !cached;

      if (cached) {
        setBrowse(cached);
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

        const data = await loadBrowseFolder(path, { updateRecent, signal: controller.signal });
        if (generation !== loadGenerationRef.current) {
          return null;
        }
        setBrowse(data);
        return data;
      } catch (err) {
        if (generation !== loadGenerationRef.current || isAbortError(err)) {
          return null;
        }
        const resolved = resolveBrowseError(err);
        if (resolved?.kind === "folder-not-found") {
          evictCachedBrowse(path);
          setBrowse((current) => {
            const folderPath =
              path ?? current?.folder ?? lastRequestedPathRef.current ?? getCachedLastFolder();
            if (!folderPath) {
              return null;
            }
            return createFailedBrowseShell(folderPath, current);
          });
        } else if (!silent) {
          setBrowse(null);
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
      if (historyMode === "push" && path && browse?.folder === path) return;

      if (path) {
        setBrowse((current) =>
          current ? applyOptimisticBrowse(current, path) : createFailedBrowseShell(path, null),
        );
        if (historyMode !== "none") {
          syncFolderHistory(path, historyMode);
        }
      }

      const data = await loadFolder(path);
      if (data && path && historyMode !== "none" && data.folder !== path) {
        syncFolderHistory(data.folder, "replace");
      }
    },
    [browse?.folder, loadFolder],
  );

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const initialPath = getFolderFromUrl();
    loadFolder(initialPath).then((data) => {
      if (data) {
        syncFolderHistory(data.folder, "replace");
      }
    });
  }, [loadFolder]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const path = getFolderFromHistoryEvent(event);
      syncFolderHistory(path, "none");

      if (path) {
        setBrowse((current) =>
          current ? applyOptimisticBrowse(current, path) : createFailedBrowseShell(path, null),
        );
      }

      void loadFolder(path);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadFolder]);

  const reloadFolder = useCallback(
    async ({ silent = true }: ReloadFolderOptions = {}) => {
      if (!browse?.folder) return null;
      return loadFolder(browse.folder, {
        preserveSelection: true,
        updateRecent: false,
        silent,
      });
    },
    [browse?.folder, loadFolder],
  );

  return { browse, loading, refreshing, error, reloadFolder, navigateTo, setBrowse };
}
