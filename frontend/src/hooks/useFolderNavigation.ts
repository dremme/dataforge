import { useCallback, useEffect, useRef, useState } from "react";
import { buildBreadcrumbs } from "../breadcrumbs";
import {
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
  type HistoryMode,
} from "../folderHistory";
import { getCachedLastFolder, loadBrowseFolder } from "../folderPreferences";
import { resolveBrowseError, type BrowseError } from "../api/http";
import type { BrowseResponse } from "../types";

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
  const lastRequestedPathRef = useRef<string | undefined>(undefined);

  const loadFolder = useCallback(
    async (
      path?: string,
      { preserveSelection = false, updateRecent = true, silent = false }: LoadFolderOptions = {},
    ) => {
      lastRequestedPathRef.current = path;
      const generation = ++loadGenerationRef.current;
      setError(null);

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
        if (!preserveSelection) {
          onFolderChange?.();
        }
      }

      try {
        const data = await loadBrowseFolder(path, { updateRecent });
        if (generation !== loadGenerationRef.current) {
          return null;
        }
        setBrowse(data);
        return data;
      } catch (err) {
        if (generation !== loadGenerationRef.current) {
          return null;
        }
        const resolved = resolveBrowseError(err);
        if (resolved?.kind === "folder-not-found") {
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
          if (silent) {
            setRefreshing(false);
          } else {
            setLoading(false);
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
