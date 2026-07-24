import { useCallback, useMemo } from "react";
import { useCreateFolderDialog } from "@/features/browse/hooks/useCreateFolderDialog";
import { useFolderChangeDetection } from "@/features/browse/hooks/useFolderChangeDetection";
import { useFolderFileDrop } from "@/features/browse/hooks/useFolderFileDrop";
import { useFolderNavigation } from "@/features/browse/hooks/useFolderNavigation";

type UseFolderSessionOptions = {
  onNavigateAway: () => void;
  /** When true (active folder job), pause background browse reloads. */
  suspendReloads: boolean;
};

/**
 * Folder navigation, fingerprint reloads, create-folder, and file import.
 */
export function useFolderSession({ onNavigateAway, suspendReloads }: UseFolderSessionOptions) {
  const { browse, loading, refreshing, error, navigateTo, setBrowse, reloadFolder } =
    useFolderNavigation(onNavigateAway);

  const reloadFolderSilently = useCallback(() => reloadFolder({ silent: true }), [reloadFolder]);
  const folderNotFound = error?.kind === "folder-not-found";
  const folderLabel =
    browse?.breadcrumbs[browse.breadcrumbs.length - 1]?.name ?? browse?.folder ?? "this folder";

  const { syncBaseline } = useFolderChangeDetection(
    browse?.folder,
    browse?.fingerprint,
    reloadFolderSilently,
    {
      suspendReloads,
      enabled: !folderNotFound,
    },
  );

  const refreshFolder = useCallback(async () => {
    await reloadFolderSilently();
    await syncBaseline();
  }, [reloadFolderSilently, syncBaseline]);

  const createFolder = useCreateFolderDialog({
    parentFolder: browse?.folder,
    parentLabel: folderLabel,
    enabled: Boolean(browse?.folder) && !folderNotFound,
    onCreated: async (path) => {
      await navigateTo(path);
      await syncBaseline();
    },
  });

  const fileDrop = useFolderFileDrop({
    folderPath: browse?.folder,
    enabled: Boolean(browse) && !folderNotFound && !loading,
    onImported: refreshFolder,
  });

  const subfolders = useMemo(() => browse?.subfolders ?? [], [browse?.subfolders]);
  const items = useMemo(() => browse?.items ?? [], [browse?.items]);
  const sysprompt = browse?.sysprompt ?? null;

  return {
    browse,
    loading,
    refreshing,
    error,
    folderNotFound,
    folderLabel,
    subfolders,
    items,
    sysprompt,
    navigateTo,
    setBrowse,
    reloadFolderSilently,
    refreshFolder,
    createFolder,
    fileDrop,
  };
}
