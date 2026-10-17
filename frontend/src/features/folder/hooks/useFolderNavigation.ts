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
import { useRouter } from "@tanstack/react-router";
import { buildBreadcrumbs } from "@/features/folder/lib/breadcrumbs";
import {
  entryKeyOf,
  folderOfLocation,
  syncFolderHistory,
  type HistoryMode,
} from "@/features/folder/lib/folderHistory";
import { foldersMatch } from "@/features/folder/lib/folderPath";
import { getCachedLastFolder, rememberOpenedFolder } from "@/features/folder/lib/folderPreferences";
import {
  folderKeys,
  folderQueryOptions,
  openFolderQuery,
  oweSubfolderRecount,
} from "@/features/folder/lib/folderQuery";
import {
  forgetFolderScroll,
  recallFolderScroll,
  rememberFolderScroll,
} from "@/features/folder/lib/folderScrollMemory";
import { resolveFolderError, type FolderError } from "@/shared/api/http";
import { getAppScrollElement } from "@/shared/lib/appScroll";
import type { FolderResponse } from "@/shared/types";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

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

export function useFolderNavigation(
  onFolderChange?: () => void,
  requestTransition?: (action: () => void | Promise<void>) => Promise<void>,
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [requestedPath, setRequestedPath] = useState(() => folderOfLocation(router));
  const requestedPathRef = useLatestRef(requestedPath);
  const [scrollIntent, setScrollIntent] = useState<FolderScrollIntent | null>(null);
  const scrollIntentIdRef = useRef(0);
  const currentEntryKeyRef = useRef(entryKeyOf(router.history.location));
  const initialHistorySyncedRef = useRef(false);

  // Live updates (pushes, polling, focus) belong to useFolderChangeDetection.
  const query = useQuery({
    ...folderQueryOptions(requestedPath),
    placeholderData: (previous) =>
      previous && requestedPath ? applyOptimisticFolder(previous, requestedPath) : undefined,
    refetchOnWindowFocus: false,
  });

  const { data, error: queryError, isPlaceholderData, isFetching } = query;
  // The last settled listing, kept for the shell shown when the folder then goes missing.
  const [lastFolder, setLastFolder] = useState<FolderResponse | null>(null);
  if (data && !isPlaceholderData && data !== lastFolder) setLastFolder(data);
  const error: FolderError | null = query.isError ? resolveFolderError(queryError) : null;

  // The server answers with its own spelling of the path, or names the default folder:
  // file the listing under that path and make it the one being shown.
  const settledPath = !isPlaceholderData ? data?.path : undefined;
  useEffect(() => {
    if (!settledPath || !data) return;

    const canonical = requestedPath === undefined || !foldersMatch(settledPath, requestedPath);
    if (canonical) {
      queryClient.setQueryData(folderKeys.folder(settledPath), data);
      // The cache write above must land first, or the canonical key reads empty.
      // oxlint-disable-next-line react-hooks/set-state-in-effect -- after the cache write
      setRequestedPath(settledPath);
    }
    if (canonical || !initialHistorySyncedRef.current) {
      initialHistorySyncedRef.current = true;
      currentEntryKeyRef.current = syncFolderHistory(router, settledPath, "replace");
    }
  }, [data, queryClient, requestedPath, router, settledPath]);

  // Opening a folder, not re-reading it, is what makes it recent.
  useEffect(() => {
    if (settledPath) rememberOpenedFolder(settledPath);
  }, [settledPath]);

  const folder = useMemo((): FolderResponse | null => {
    if (error?.kind === "folder-not-found") {
      const path = requestedPath ?? lastFolder?.path ?? getCachedLastFolder();
      return path ? createFailedFolderShell(path, lastFolder) : null;
    }
    if (data) return data;
    if (query.isError) return null;
    return requestedPath ? createFailedFolderShell(requestedPath, null) : null;
  }, [data, error?.kind, lastFolder, query.isError, requestedPath]);

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
        currentEntryKeyRef.current = syncFolderHistory(router, path, historyMode);
        if (historyMode === "replace") {
          forgetFolderScroll(currentEntryKeyRef.current);
        }
      }

      onFolderChange?.();
      await openFolder(path);
    },
    [folder?.path, onFolderChange, openFolder, router, saveOutgoingScroll],
  );

  // Back and Forward; the folder view's own pushes and replaces are handled where they are made.
  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE") return;
        const path = folderOfLocation(router, location);
        const entryKey = entryKeyOf(location);
        // An entry over this one, like the video editor's, shares its key and folder.
        if (
          entryKey === currentEntryKeyRef.current &&
          (path === requestedPathRef.current || foldersMatch(path, requestedPathRef.current))
        ) {
          return;
        }
        const open = async () => {
          saveOutgoingScroll();
          currentEntryKeyRef.current = entryKey;
          setScrollIntent({
            id: ++scrollIntentIdRef.current,
            mode: "restore",
            path,
            target: recallFolderScroll(entryKey) ?? 0,
          });

          onFolderChange?.();
          await openFolder(path);
        };
        if (requestTransition) void requestTransition(open);
        else void open();
      }),
    [onFolderChange, openFolder, requestedPathRef, requestTransition, router, saveOutgoingScroll],
  );

  /** Re-reads in place: the listing stays on screen while the changes are fetched. */
  const reloadFolder = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: folderKeys.folder(requestedPath), exact: true }),
    [queryClient, requestedPath],
  );

  /** The user's own Refresh also recounts subfolders, which a re-read alone may not. */
  const refreshFolderAndCounts = useCallback(async () => {
    await reloadFolder();
    if (requestedPath) oweSubfolderRecount(queryClient, requestedPath);
  }, [queryClient, reloadFolder, requestedPath]);

  const setFolder = useCallback<Dispatch<SetStateAction<FolderResponse | null>>>(
    (update) => {
      queryClient.setQueryData<FolderResponse>(folderKeys.folder(requestedPath), (current) => {
        const next = typeof update === "function" ? update(current ?? null) : update;
        return next ?? current;
      });
    },
    [queryClient, requestedPath],
  );

  return {
    folder,
    loading,
    refreshing,
    error,
    reloadFolder,
    refreshFolderAndCounts,
    navigateTo,
    setFolder,
    scrollIntent,
  };
}
