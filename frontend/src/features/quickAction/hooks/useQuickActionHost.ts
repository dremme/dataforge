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
  iconFolderInput,
  iconFolderOpen,
  iconFolderPlus,
  iconHome,
  iconMessageWarning,
  iconRefresh,
  iconTrash2,
} from "@/shared/icons";
import { useNotify } from "@/shared/notifications/notifications";
import type { FolderFavorite, FolderResponse } from "@/shared/types";
import {
  buildFavoriteItems,
  buildJobItems,
  buildRecentFolderItems,
  buildRunJobItems,
  buildSidecarSweepItems,
  buildSubfolderItems,
  folderPathFromQuickActionId,
  folderQuickAction,
} from "../lib/buildQuickActionItems";
import { readRecentActionIds } from "../lib/quickActionHistory";
import { orderQuickActionItems, resolveRecentActions } from "../lib/quickActionResults";
import type { QuickActionItem, QuickActionSection } from "../types";
import { useQuickAction } from "./useQuickAction";

/**
 * What a first-run palette falls back to when there is no history yet. Places,
 * not actions: an empty palette offering to start a job would be a trap.
 */
const TOP_UP_SECTIONS = new Set<QuickActionSection>(["subfolders", "recentFolders", "favorites"]);

interface UseQuickActionHostOptions {
  folder: FolderResponse | null;
  folderNotFound: boolean;
  navigateTo: (path?: string) => void | Promise<void>;
  refreshFolder: () => void | Promise<void>;
  onOpenFolderPicker: () => void;
  onCreateFolder: () => void;
  /** The automation panel's props — the palette drives the same handlers its menu does. */
  panel: AutomationPanelProps;
  /** Delete / move / copy for the gallery selection, as the toolbar drives them. */
  selection: GallerySelectionActions;
  selectedCount: number;
  /** Delete every finding sidecar of one kind, as a folder-scoped batch. */
  sidecarSweep: SidecarSweepActions;
}

/**
 * Assembles everything the quick action bar can search, and owns its open state.
 *
 * Composed alongside `useAutomationHost` rather than inside the overlay so the
 * palette reads the same handlers the panel and menu already use — starting a job
 * from here is indistinguishable from starting it there.
 */
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
  sidecarSweep,
}: UseQuickActionHostOptions) {
  const { open, close } = useQuickAction();
  const { jobs, externalJobs } = useJobs();
  const notify = useNotify();

  const [favorites, setFavorites] = useState<FolderFavorite[]>(() => getCachedFolderFavorites());
  const [recentFolderPaths, setRecentFolderPaths] = useState<string[]>([]);
  const [recentActionIds, setRecentActionIds] = useState<string[]>([]);

  // Both lists live in localStorage and change outside React, so they are re-read
  // on every open rather than memoised for the life of the session.
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
      // The palette is already gone by the time this resolves, so the outcome has
      // to surface as a notification rather than as inline button feedback.
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
        label: "Open folder…",
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

    commands.push(
      ...buildSidecarSweepItems({
        hasFolder: !folderNotFound,
        counts: sidecarSweep.counts,
        busy: sidecarSweep.busy,
        onSweep: sidecarSweep.openSweep,
      }),
    );

    // Only while something is selected: these read as dead weight otherwise, and
    // the flows they start would have nothing to act on.
    if (selectedCount > 0) {
      const selectionDetail = `${selectedCount} selected file${selectedCount === 1 ? "" : "s"}`;

      commands.push(
        {
          id: "cmd:move-selected",
          section: "commands",
          label: "Move selected files",
          detail: selectionDetail,
          icon: iconFolderInput,
          keywords: "selection transfer relocate",
          disabled: !selection.canAct,
          run: () => selection.startTransfer("move"),
        },
        {
          id: "cmd:copy-selected",
          section: "commands",
          label: "Copy selected files",
          detail: selectionDetail,
          icon: iconCopy,
          keywords: "selection transfer duplicate",
          disabled: !selection.canAct,
          run: () => selection.startTransfer("copy"),
        },
        {
          id: "cmd:delete-selected",
          section: "commands",
          label: "Delete selected files",
          detail: selectionDetail,
          icon: iconTrash2,
          keywords: "selection remove trash",
          disabled: !selection.canAct,
          run: selection.openDeleteConfirm,
        },
      );
    }

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
    panel.issueCount,
    panel.onEditSysprompt,
    panel.onResolveDuplicates,
    panel.onResolveIssues,
    refreshFolder,
    revealInExplorer,
    selectedCount,
    selection,
    sidecarSweep,
  ]);

  // Keyed by section rather than concatenated, so `QUICK_ACTION_SECTIONS` alone
  // decides both the display order and which copy of a shared id survives.
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
        // A folder that has since fallen out of recents and favorites is still
        // navigable — its path is inside the id.
        (id) => {
          const path = folderPathFromQuickActionId(id);
          return path ? folderQuickAction(path, "recentFolders", goTo) : null;
        },
        // Drawn from the ordered list rather than the raw builders, so the
        // top-up cannot reintroduce a folder the dedupe just dropped.
        items.filter((item) => TOP_UP_SECTIONS.has(item.section)),
      ),
    [goTo, items, recentActionIds],
  );

  return { open, close, items, recentItems };
}

export type QuickActionOverlayState = ReturnType<typeof useQuickActionHost>;
