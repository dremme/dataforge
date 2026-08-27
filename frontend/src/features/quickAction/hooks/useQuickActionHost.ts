import { useCallback, useEffect, useMemo, useState } from "react";
import type { AutomationPanelProps } from "@/features/automation/components/AutomationPanel";
import {
  getCachedFolderFavorites,
  refreshFolderFavoritesInBackground,
} from "@/features/folder/lib/folderFavorites";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import type { GallerySelectionActions } from "@/features/gallery/hooks/useGallerySelectionActions";
import type { SidecarSweepActions } from "@/features/gallery/hooks/useSidecarSweep";
import { readRecentFolderPaths } from "@/features/folder/lib/folderPreferences";
import { openFolderInExplorer } from "@/features/folder/api/folders";
import { useJobs } from "@/features/jobs/context/JobsContext";
import { formatApiError } from "@/shared/api/http";
import {
  iconArrowUp,
  iconArrowUpRight,
  iconCode,
  iconCopy,
  iconFiles,
  iconFolderOpen,
  iconFolderPlus,
  iconHome,
  iconMessageWarning,
  iconRefresh,
  iconScanSquare,
} from "@/shared/icons";
import { useNotify } from "@/shared/notifications/notifications";
import type { FolderFavorite, FolderResponse } from "@/shared/types";
import {
  buildFavoriteItems,
  buildJobItems,
  buildRecentFolderItems,
  buildRunJobItems,
  buildSelectionCommandItems,
  buildSidecarSweepItems,
  buildSubfolderItems,
  folderPathFromQuickActionId,
  folderQuickAction,
} from "../lib/buildQuickActionItems";
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

  const commandItems = useMemo<QuickActionItem[]>(() => {
    const commands: QuickActionItem[] = [
      {
        id: "cmd:open-folder",
        section: "commands",
        label: "Open folder...",
        detail: "Pick a folder by path, favorite or recent",
        icon: iconFolderOpen,
        keywords: "browse path picker",
        run: onOpenFolderPicker,
      },
    ];

    if (!folder) return commands;

    if (!folderNotFound) {
      commands.push({
        id: "cmd:new-folder",
        section: "commands",
        label: "New folder",
        detail: "Create a subfolder here",
        icon: iconFolderPlus,
        keywords: "create make directory",
        run: onCreateFolder,
      });
    }

    if (folder.parent) {
      const parent = folder.parent;
      commands.push({
        id: "cmd:parent-folder",
        section: "commands",
        label: "Go to parent folder",
        detail: parent,
        icon: iconArrowUp,
        keywords: "up back",
        run: () => goTo(parent),
      });
    }

    if (!folderPathsEqual(folder.path, folder.home)) {
      const home = folder.home;
      commands.push({
        id: "cmd:home-folder",
        section: "commands",
        label: "Go to home folder",
        detail: home,
        icon: iconHome,
        keywords: "root start",
        run: () => goTo(home),
      });
    }

    commands.push({
      id: "cmd:refresh-folder",
      section: "commands",
      label: "Refresh folder",
      detail: "Reload this folder from disk",
      icon: iconRefresh,
      keywords: "reload rescan",
      run: () => void refreshFolder(),
    });

    if (panel.onResolveIssues) {
      commands.push({
        id: "cmd:resolve-issues",
        section: "commands",
        label: "Resolve caption issues",
        detail: `${panel.issueCount} flagged`,
        icon: iconMessageWarning,
        keywords: "fix captions problems",
        run: panel.onResolveIssues,
      });
    }

    if (panel.onResolveDuplicates) {
      commands.push({
        id: "cmd:resolve-duplicates",
        section: "commands",
        label: "Resolve duplicates",
        detail: `${panel.duplicateGroupCount} group${panel.duplicateGroupCount === 1 ? "" : "s"}`,
        icon: iconFiles,
        keywords: "dedupe near identical",
        run: panel.onResolveDuplicates,
      });
    }

    if (panel.onReviewCandidates) {
      const candidates = panel.candidateCount ?? 0;
      commands.push({
        id: "cmd:review-candidates",
        section: "commands",
        label: "Review candidates",
        detail: `${candidates} waiting`,
        icon: iconScanSquare,
        keywords: "comfyui upscale staging accept reject compare",
        run: panel.onReviewCandidates,
      });
    }

    commands.push(
      ...buildSidecarSweepItems({
        hasFolder: !folderNotFound,
        counts: sidecarSweep.counts,
        busy: sidecarSweep.busy,
        onSweep: sidecarSweep.openSweep,
      }),
      ...buildSelectionCommandItems({
        hasFolder: !folderNotFound,
        selectionMode,
        selectedCount,
        visibleCount,
        busy: selection.busy,
        onSelectAll,
        onInvertSelection,
        onMove: () => selection.startTransfer("move"),
        onCopy: () => selection.startTransfer("copy"),
        onDelete: selection.openDeleteConfirm,
      }),
    );

    commands.push({
      id: "cmd:edit-sysprompt",
      section: "commands",
      label: "Edit system prompt",
      detail: "The captioning instructions for this folder",
      icon: iconCode,
      keywords: "sysprompt instructions",
      run: panel.onEditSysprompt,
    });

    if (!folderNotFound) {
      const path = folder.path;
      commands.push(
        {
          id: "cmd:copy-path",
          section: "commands",
          label: "Copy folder path",
          detail: path,
          icon: iconCopy,
          keywords: "clipboard",
          run: () => copyFolderPath(path),
        },
        {
          id: "cmd:open-in-explorer",
          section: "commands",
          label: "Open in File Explorer",
          detail: path,
          icon: iconArrowUpRight,
          keywords: "reveal windows",
          run: () => revealInExplorer(path),
        },
      );
    }

    return commands;
  }, [
    copyFolderPath,
    folder,
    folderNotFound,
    goTo,
    onCreateFolder,
    onOpenFolderPicker,
    panel.duplicateGroupCount,
    panel.candidateCount,
    panel.issueCount,
    panel.onEditSysprompt,
    panel.onResolveDuplicates,
    panel.onReviewCandidates,
    panel.onResolveIssues,
    refreshFolder,
    revealInExplorer,
    onInvertSelection,
    onSelectAll,
    selectedCount,
    selection,
    selectionMode,
    sidecarSweep,
    visibleCount,
  ]);

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
      }),
    [
      commandItems,
      externalJobs,
      favorites,
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
