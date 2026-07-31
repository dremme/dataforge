import { useCallback, useMemo, useRef } from "react";
import { useAutomationHost } from "@/features/automation/hooks/useAutomationHost";
import { useFolderAutomation } from "@/features/automation/hooks/useFolderAutomation";
import { useCreateFolderDialog } from "@/features/browse/hooks/useCreateFolderDialog";
import { useFolderChangeDetection } from "@/features/browse/hooks/useFolderChangeDetection";
import { useFolderFileDrop } from "@/features/browse/hooks/useFolderFileDrop";
import { useFolderNavigation } from "@/features/browse/hooks/useFolderNavigation";
import { useGallerySelection } from "@/features/gallery/hooks/useGallerySelection";
import { useGallerySession } from "@/features/gallery/hooks/useGallerySession";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { filterSubfoldersBySearch } from "@/features/gallery/lib/query";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

/**
 * Top-level composition: selection → folder → automation core → gallery → automation host.
 */
export function useAppWorkspace() {
  const mainRef = useRef<HTMLElement>(null);
  const selection = useGallerySelection();
  const { ostrisAvailable } = useJobs();

  const { browse, loading, refreshing, error, navigateTo, setBrowse, reloadFolder } =
    useFolderNavigation(selection.clearSelection);

  const reloadFolderSilently = useCallback(() => reloadFolder({ silent: true }), [reloadFolder]);
  const folderNotFound = error?.kind === "folder-not-found";
  const folderLabel =
    browse?.breadcrumbs[browse.breadcrumbs.length - 1]?.name ?? browse?.folder ?? "this folder";

  const folderAutomation = useFolderAutomation(browse?.folder, reloadFolderSilently);

  const { syncBaseline } = useFolderChangeDetection(
    browse?.folder,
    browse?.fingerprint,
    reloadFolderSilently,
    {
      suspendReloads: folderAutomation.folderHasActiveJob,
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

  useDocumentTitle(browse?.folder, browse?.breadcrumbs ?? []);

  const gallery = useGallerySession({
    selection,
    items,
    folder: browse?.folder,
    sysprompt,
    setBrowse,
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
    folder: browse?.folder,
    breadcrumbs: browse?.breadcrumbs ?? [],
    items,
    filteredItems: gallery.query.filteredItems,
    sysprompt,
    hasCaptionBackup: browse?.has_caption_backup ?? false,
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
    browse,
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
