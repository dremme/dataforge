import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildBreadcrumbs } from "@/features/folder/lib/breadcrumbs";
import {
  getCurrentEntryKey,
  getEntryKeyFromHistoryEvent,
  getFolderFromHistoryEvent,
  getFolderFromUrl,
  syncFolderHistory,
  type HistoryMode,
} from "@/features/folder/lib/folderHistory";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { getCachedLastFolder, rememberOpenedFolder } from "@/features/folder/lib/folderPreferences";
import { folderKeys, folderQueryOptions, openFolderQuery } from "@/features/folder/lib/folderQuery";
import {
  forgetFolderScroll,
  recallFolderScroll,
  rememberFolderScroll,
} from "@/features/folder/lib/folderScrollMemory";
import { resolveFolderError, type FolderError } from "@/shared/api/http";
import { getAppScrollElement } from "@/shared/lib/appScroll";
import type { FolderResponse } from "@/shared/types";

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
    has_sysprompt: false,
    sysprompt_applies: false,
    has_caption_backup: false,
    has_caption_rules: false,
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

export function useFolderNavigation(onFolderChange?: () => void) {
  const queryClient = useQueryClient();
  const [requestedPath, setRequestedPath] = useState<string | undefined>(getFolderFromUrl);
  const [scrollIntent, setScrollIntent] = useState<FolderScrollIntent | null>(null);
  const scrollIntentIdRef = useRef(0);
  const currentEntryKeyRef = useRef<string | undefined>(getCurrentEntryKey());
  const initialHistorySyncedRef = useRef(false);
  const lastFolderRef = useRef<FolderResponse | null>(null);

  // Live updates (pushes, polling, focus) belong to useFolderChangeDetection, which can
  // pause them while a job rewrites the folder.
  const query = useQuery({
    ...folderQueryOptions(requestedPath),
    placeholderData: (previous) =>
      previous && requestedPath ? applyOptimisticFolder(previous, requestedPath) : undefined,
    refetchOnWindowFocus: false,
  });

  const { data, error: queryError, isPlaceholderData, isFetching } = query;
  const error: FolderError | null = query.isError ? resolveFolderError(queryError) : null;

  // The server answers with its own spelling of the path, or names the default folder:
  // file the listing under that path and make it the one being shown.
  const settledPath = !isPlaceholderData ? data?.path : undefined;
  useEffect(() => {
    if (!settledPath || !data) return;

    const canonical = requestedPath === undefined || !foldersMatch(settledPath, requestedPath);
    if (canonical) {
      queryClient.setQueryData(folderKeys.folder(settledPath), data);
      setRequestedPath(settledPath);
    }
    if (canonical || !initialHistorySyncedRef.current) {
      initialHistorySyncedRef.current = true;
      currentEntryKeyRef.current = syncFolderHistory(settledPath, "replace");
    }
  }, [data, queryClient, requestedPath, settledPath]);

  // Opening a folder, not re-reading it, is what makes it recent.
  useEffect(() => {
    if (settledPath) rememberOpenedFolder(settledPath);
  }, [settledPath]);

  const folder = useMemo((): FolderResponse | null => {
    if (error?.kind === "folder-not-found") {
      const path = requestedPath ?? lastFolderRef.current?.path ?? getCachedLastFolder();
      return path ? createFailedFolderShell(path, lastFolderRef.current) : null;
    }
    if (data) return data;
    if (query.isError) return null;
    return requestedPath ? createFailedFolderShell(requestedPath, null) : null;
  }, [data, error?.kind, query.isError, requestedPath]);

  useEffect(() => {
    if (data && !isPlaceholderData) lastFolderRef.current = data;
  }, [data, isPlaceholderData]);

  const loading = !query.isError && (!data || isPlaceholderData);
  const refreshing = isFetching && !loading;

  const openFolder = useCallback(
    async (path: string | undefined) => {
      // Started before the view switches over, so the view joins this read, not its own.
      const read = openFolderQuery(queryClient, path);
      setRequestedPath(path);
      await read.catch(() => {
        // The query's own error state reports this to the view.
      });
    },
    [queryClient],
  );

  const saveOutgoingScroll = useCallback(() => {
    const element = getAppScrollElement();
    if (!element) return;
    rememberFolderScroll(currentEntryKeyRef.current, element.scrollTop);
  }, []);

  const navigateTo = useCallback(
    async (path?: string, historyMode: HistoryMode = "push") => {
      if (historyMode === "push" && path && foldersMatch(folder?.path, path)) return;

      if (historyMode === "push") {
        saveOutgoingScroll();
      }
      setScrollIntent({ id: ++scrollIntentIdRef.current, mode: "reset", path, target: 0 });

      if (path && historyMode !== "none") {
        currentEntryKeyRef.current = syncFolderHistory(path, historyMode);
        if (historyMode === "replace") {
          forgetFolderScroll(currentEntryKeyRef.current);
        }
      }

      onFolderChange?.();
      await openFolder(path);
    },
    [folder?.path, onFolderChange, openFolder, saveOutgoingScroll],
  );

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

      onFolderChange?.();
      void openFolder(path);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [onFolderChange, openFolder, saveOutgoingScroll]);

  /** Re-reads in place: the listing stays on screen while the changes are fetched. */
  const reloadFolder = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: folderKeys.folder(requestedPath), exact: true }),
    [queryClient, requestedPath],
  );

  const setFolder = useCallback<Dispatch<SetStateAction<FolderResponse | null>>>(
    (update) => {
      queryClient.setQueryData<FolderResponse>(folderKeys.folder(requestedPath), (current) => {
        const next = typeof update === "function" ? update(current ?? null) : update;
        return next ?? current;
      });
    },
    [queryClient, requestedPath],
  );

  return { folder, loading, refreshing, error, reloadFolder, navigateTo, setFolder, scrollIntent };
}
