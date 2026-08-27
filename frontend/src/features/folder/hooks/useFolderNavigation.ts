import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFolderFingerprint } from "@/features/folder/api/folderContents";
import { buildBreadcrumbs } from "@/features/folder/lib/breadcrumbs";
import { evictCachedFolder, readCachedFolder } from "@/features/folder/lib/folderCache";
import {
  getCurrentEntryKey,
  getEntryKeyFromHistoryEvent,
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
  type HistoryMode,
} from "@/features/folder/lib/folderHistory";
import { getCachedLastFolder, loadFolderContents } from "@/features/folder/lib/folderPreferences";
import {
  forgetFolderScroll,
  recallFolderScroll,
  rememberFolderScroll,
} from "@/features/folder/lib/folderScrollMemory";
import { isAbortError, resolveFolderError, type FolderError } from "@/shared/api/http";
import { getAppScrollElement } from "@/shared/lib/appScroll";
import type { FolderResponse } from "@/shared/types";

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

export type FolderScrollIntent = {
  id: number;
  mode: "reset" | "restore";
  path: string | undefined;
  target: number;
};

export type LoadFolderOptions = {
  preserveSelection?: boolean;
  updateRecent?: boolean;
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
  const [scrollIntent, setScrollIntent] = useState<FolderScrollIntent | null>(null);
  const scrollIntentIdRef = useRef(0);
  const currentEntryKeyRef = useRef<string | undefined>(getCurrentEntryKey());

  const saveOutgoingScroll = useCallback(() => {
    const element = getAppScrollElement();
    if (!element) return;
    rememberFolderScroll(currentEntryKeyRef.current, element.scrollTop);
  }, []);

  const loadFolder = useCallback(
    async (
      path?: string,
      { preserveSelection = false, updateRecent = true, silent = false }: LoadFolderOptions = {},
    ) => {
      lastRequestedPathRef.current = path;
      const generation = ++loadGenerationRef.current;
      setError(null);

      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

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
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [onFolderChange],
  );

  const navigateTo = useCallback(
    async (path?: string, historyMode: HistoryMode = "push") => {
      if (historyMode === "push" && path && folder?.path === path) return;

      if (historyMode === "push") {
        saveOutgoingScroll();
      }
      setScrollIntent({ id: ++scrollIntentIdRef.current, mode: "reset", path, target: 0 });

      if (path) {
        setFolder((current) =>
          current ? applyOptimisticFolder(current, path) : createFailedFolderShell(path, null),
        );
        if (historyMode !== "none") {
          currentEntryKeyRef.current = syncFolderHistory(path, historyMode);
          if (historyMode === "replace") {
            forgetFolderScroll(currentEntryKeyRef.current);
          }
        }
      }

      const data = await loadFolder(path);
      if (data && path && historyMode !== "none" && data.path !== path) {
        currentEntryKeyRef.current = syncFolderHistory(data.path, "replace");
      }
    },
    [folder?.path, loadFolder, saveOutgoingScroll],
  );

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const initialPath = getFolderFromUrl();
    loadFolder(initialPath).then((data) => {
      if (data) {
        currentEntryKeyRef.current = syncFolderHistory(data.path, "replace");
      }
    });
  }, [loadFolder]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const path = getFolderFromHistoryEvent(event);

      saveOutgoingScroll();
      const entryKey = getEntryKeyFromHistoryEvent(event);
      currentEntryKeyRef.current = entryKey;
      setScrollIntent({
        id: ++scrollIntentIdRef.current,
        mode: "restore",
        path,
        target: recallFolderScroll(entryKey) ?? 0,
      });

      if (path) {
        setFolder((current) =>
          current ? applyOptimisticFolder(current, path) : createFailedFolderShell(path, null),
        );
      }

      void loadFolder(path);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [loadFolder, saveOutgoingScroll]);

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

  return { folder, loading, refreshing, error, reloadFolder, navigateTo, setFolder, scrollIntent };
}
