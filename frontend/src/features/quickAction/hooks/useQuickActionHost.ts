import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import {
  getCachedFolderFavorites,
  refreshFolderFavoritesInBackground,
} from "@/features/folder/lib/folderFavorites";
import type { AcceptAllCandidatesActions } from "@/features/gallery/hooks/useAcceptAllCandidates";
import type { GallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";
import type { SidecarSweepActions } from "@/features/gallery/hooks/useSidecarSweep";
import { readRecentFolderPaths } from "@/features/folder/lib/folderPreferences";
import { fetchFolderRoots, openFolderInExplorer } from "@/features/folder/api/folders";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { FolderFavorite, FolderResponse } from "@/shared/types";
import {
  buildCommandItems,
  buildFavoriteItems,
  buildJobItems,
  buildRecentFolderItems,
  buildFilterItems,
  buildRunJobItems,
  buildSubfolderItems,
  folderPathFromQuickActionId,
  folderQuickAction,
} from "../lib/buildQuickActionItems";
import type { FilterCommandOptions } from "../lib/buildQuickActionItems";
import { readRecentActionIds } from "../lib/quickActionHistory";
import { orderQuickActionItems, resolveRecentActions } from "../lib/quickActionResults";
import type { QuickActionItem, QuickActionSection } from "../types";
import { useQuickAction } from "./useQuickAction";

const TOP_UP_SECTIONS = new Set<QuickActionSection>(["subfolders", "recentFolders", "favorites"]);

interface UseQuickActionHostOptions {
  folder: FolderResponse | null;
  folderNotFound: boolean;
  navigateTo: (path?: string) => void | Promise<void>;
  refreshFolder: () => void | Promise<void>;
  onOpenFolderPicker: () => void;
  onCreateFolder: () => void;
  panel: AutomationPanelProps;
  selection: GallerySelectionActions;
  selectedCount: number;
  selectionMode: boolean;
  visibleCount: number;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  sidecarSweep: SidecarSweepActions;
  acceptAllCandidates: AcceptAllCandidatesActions;
  filters: Omit<FilterCommandOptions, "hasFolder">;
}

export function useQuickActionHost({
  folder,
  folderNotFound,
  navigateTo,
  refreshFolder,
  onOpenFolderPicker,
  onCreateFolder,
  panel,
  selection,
  selectedCount,
  selectionMode,
  visibleCount,
  onSelectAll,
  onInvertSelection,
  sidecarSweep,
  acceptAllCandidates,
  filters,
}: UseQuickActionHostOptions) {
  const { open, close } = useQuickAction();
  const { jobs, externalJobs } = useJobs();
  const notify = useNotify();

  const [favorites, setFavorites] = useState<FolderFavorite[]>(() => getCachedFolderFavorites());
  const [recentFolderPaths, setRecentFolderPaths] = useState<string[]>([]);
  const [recentActionIds, setRecentActionIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;

    setRecentFolderPaths(readRecentFolderPaths());
    setRecentActionIds(readRecentActionIds());

    refreshFolderFavoritesInBackground(setFavorites);
  }, [open]);

  const goTo = useCallback(
    (path: string) => {
      void navigateTo(path);
    },
    [navigateTo],
  );

  const copyFolderPath = useCallback(
    (path: string) => {
      void navigator.clipboard.writeText(path).then(
        () => notify({ variant: "success", message: "Folder path copied." }),
        () => notify({ variant: "danger", message: "Could not copy the folder path." }),
      );
    },
    [notify],
  );

  const goHome = useCallback(() => {
    if (folder && !folderNotFound) {
      goTo(folder.home);
      return;
    }

    void fetchFolderRoots()
      .then(({ home }) => navigateTo(home))
      .catch((error: unknown) => {
        notify({ variant: "danger", message: formatApiError(error) });
      });
  }, [folder, folderNotFound, goTo, navigateTo, notify]);

  const revealInExplorer = useCallback(
    (path: string) => {
      void openFolderInExplorer(path).catch((error: unknown) => {
        notify({ variant: "danger", message: formatApiError(error) });
      });
    },
    [notify],
  );

  const favoritePaths = useMemo(() => favorites.map((favorite) => favorite.path), [favorites]);

  const subfolderItems = useMemo(
    () => buildSubfolderItems(folder?.subfolders ?? [], goTo),
    [folder?.subfolders, goTo],
  );

  const recentFolderItems = useMemo(
    () => buildRecentFolderItems(recentFolderPaths, folder?.path, favoritePaths, goTo),
    [favoritePaths, folder?.path, goTo, recentFolderPaths],
  );

  const commandItems = useMemo(
    () =>
      buildCommandItems({
        folder,
        folderFound: !folderNotFound,
        onOpenFolderPicker,
        onGoHome: goHome,
        onNavigate: goTo,
        onCreateFolder,
        onRefresh: () => void refreshFolder(),
        onCopyPath: copyFolderPath,
        onRevealInExplorer: revealInExplorer,
        onEditSysprompt: panel.onEditSysprompt,
        review: {
          issueCount: panel.issueCount ?? 0,
          onResolveIssues: panel.onResolveIssues,
          duplicateGroupCount: panel.duplicateGroupCount ?? 0,
          onResolveDuplicates: panel.onResolveDuplicates,
          candidateCount: panel.candidateCount ?? 0,
          onReviewCandidates: panel.onReviewCandidates,
        },
        acceptAllCandidates: {
          count: acceptAllCandidates.count,
          fromSelection: acceptAllCandidates.fromSelection,
          busy: acceptAllCandidates.busy,
          onAccept: acceptAllCandidates.openConfirm,
        },
        sidecarSweep: {
          counts: sidecarSweep.counts,
          busy: sidecarSweep.busy,
          onSweep: sidecarSweep.openSweep,
        },
        selection: {
          selectionMode,
          selectedCount,
          visibleCount,
          busy: selection.busy,
          onSelectAll,
          onInvertSelection,
          onMove: () => selection.startTransfer("move"),
          onCopy: () => selection.startTransfer("copy"),
          onDelete: selection.openDeleteConfirm,
        },
      }),
    [
      acceptAllCandidates,
      copyFolderPath,
      folder,
      folderNotFound,
      goHome,
      goTo,
      onCreateFolder,
      onInvertSelection,
      onOpenFolderPicker,
      onSelectAll,
      panel.candidateCount,
      panel.duplicateGroupCount,
      panel.issueCount,
      panel.onEditSysprompt,
      panel.onResolveDuplicates,
      panel.onResolveIssues,
      panel.onReviewCandidates,
      refreshFolder,
      revealInExplorer,
      selectedCount,
      selection,
      selectionMode,
      sidecarSweep,
      visibleCount,
    ],
  );

  const items = useMemo<QuickActionItem[]>(
    () =>
      orderQuickActionItems({
        subfolders: subfolderItems,
        recentFolders: recentFolderItems,
        favorites: buildFavoriteItems(favorites, goTo),
        jobs: buildJobItems(jobs, externalJobs, goTo),
        run: buildRunJobItems({
          availability: panel.jobAvailability,
          canStart: panel.canStart,
          hasFolder: Boolean(folder) && !folderNotFound,
          onRequestStart: panel.onRequestStart,
        }),
        commands: commandItems,
        filters: buildFilterItems({
          ...filters,
          hasFolder: Boolean(folder) && !folderNotFound,
        }),
      }),
    [
      commandItems,
      externalJobs,
      favorites,
      filters,
      folder,
      folderNotFound,
      goTo,
      jobs,
      panel.canStart,
      panel.jobAvailability,
      panel.onRequestStart,
      recentFolderItems,
      subfolderItems,
    ],
  );

  const recentItems = useMemo(
    () =>
      resolveRecentActions(
        recentActionIds,
        items,
        (id) => {
          const path = folderPathFromQuickActionId(id);
          return path ? folderQuickAction(path, "recentFolders", goTo) : null;
        },
        items.filter((item) => TOP_UP_SECTIONS.has(item.section)),
      ),
    [goTo, items, recentActionIds],
  );

  return { open, close, items, recentItems };
}

export type QuickActionOverlayState = ReturnType<typeof useQuickActionHost>;
