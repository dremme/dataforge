import { useCallback, useMemo, useRef } from "react";
import { useAutomationHost } from "@/features/automation/hooks/useAutomationHost";
import { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useCreateFolderDialog } from "@/features/folder/hooks/useCreateFolderDialog";
import { useFolderChangeDetection } from "@/features/folder/hooks/useFolderChangeDetection";
import { applyFolderDelta } from "@/features/folder/lib/applyFolderDelta";
import { useFolderFileDrop } from "@/features/folder/hooks/useFolderFileDrop";
import { useFolderNavigation } from "@/features/folder/hooks/useFolderNavigation";
import { useSubfolderStats } from "@/features/folder/hooks/useSubfolderStats";
import { useGallerySelection } from "@/features/gallery/hooks/useGallerySelection";
import { useGallerySession } from "@/features/gallery/hooks/useGallerySession";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { filterSubfoldersBySearch } from "@/features/gallery/lib/query";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import type { FolderChangesResponse } from "@/shared/types";

/**
 * Top-level composition: selection → folder → automation core → gallery → automation host.
 */
export function useAppWorkspace() {
  const mainRef = useRef<HTMLElement>(null);
  const selection = useGallerySelection();
  const { ostrisAvailable } = useJobs();

  const { folder, loading, refreshing, error, navigateTo, setFolder, reloadFolder } =
    useFolderNavigation(selection.clearSelection);

  const reloadFolderSilently = useCallback(() => reloadFolder({ silent: true }), [reloadFolder]);
  const folderNotFound = error?.kind === "folder-not-found";
  const folderLabel =
    folder?.breadcrumbs[folder.breadcrumbs.length - 1]?.name ?? folder?.path ?? "this folder";

  const folderAutomation = useFolderAutomation(folder?.path, reloadFolderSilently);

  const applyDelta = useCallback(
    (delta: FolderChangesResponse) => {
      setFolder((current) => (current ? applyFolderDelta(current, delta) : current));
    },
    [setFolder],
  );

  const { syncBaseline } = useFolderChangeDetection(
    folder?.path,
    folder?.fingerprint,
    reloadFolderSilently,
    {
      suspendReloads: folderAutomation.folderHasActiveJob,
      enabled: !folderNotFound,
      applyDelta,
    },
  );

  const refreshFolder = useCallback(async () => {
    await reloadFolderSilently();
    await syncBaseline();
  }, [reloadFolderSilently, syncBaseline]);

  const createFolder = useCreateFolderDialog({
    parentFolder: folder?.path,
    parentLabel: folderLabel,
    enabled: Boolean(folder?.path) && !folderNotFound,
    onCreated: async (path) => {
      await navigateTo(path);
      await syncBaseline();
    },
  });

  const fileDrop = useFolderFileDrop({
    folderPath: folder?.path,
    enabled: Boolean(folder) && !folderNotFound && !loading,
    onImported: refreshFolder,
  });

  const subfolders = useMemo(() => folder?.subfolders ?? [], [folder?.subfolders]);
  const items = useMemo(() => folder?.items ?? [], [folder?.items]);
  const sysprompt = folder?.sysprompt ?? null;

  useSubfolderStats(folder?.path, subfolders, setFolder, !folderNotFound);

  useDocumentTitle(folder?.path, folder?.breadcrumbs ?? []);

  const gallery = useGallerySession({
    selection,
    items,
    folderPath: folder?.path,
    sysprompt,
    setFolder,
    mainRef,
    refreshFolder,
    syncBaseline,
  });

  const { searchQuery, searchRegex } = gallery.query;

  const filteredSubfolders = useMemo(
    () => filterSubfoldersBySearch(subfolders, searchQuery, searchRegex),
    [subfolders, searchQuery, searchRegex],
  );

  const automation = useAutomationHost({
    folder: folder?.path,
    breadcrumbs: folder?.breadcrumbs ?? [],
    items,
    filteredItems: gallery.query.filteredItems,
    sysprompt,
    hasCaptionBackup: folder?.has_caption_backup ?? false,
    ostrisAvailable,
    getJobPaths: gallery.getJobPaths,
    automation: folderAutomation,
    onEditSysprompt: gallery.openSysPrompt,
    issueCount: gallery.issueCount,
    onResolveIssues:
      gallery.issueCount > 0 ? () => gallery.issueResolver.openIssueResolver(items) : undefined,
  });

  return {
    mainRef,
    folder,
    loading,
    refreshing,
    error,
    folderNotFound,
    subfolders,
    filteredSubfolders,
    items,
    navigateTo,
    createFolder,
    fileDrop,
    gallery,
    automation,
  };
}
