import { useState } from "react";
import {
  useFolderFavorites,
  useToggleFolderFavorite,
} from "@/features/folder/hooks/useFolderFavorites";
import { getRecentFoldersForPicker } from "@/features/folder/lib/folderPreferences";
import { folderLeafName, folderPathsEqual } from "@/features/folder/lib/folderPath";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { readStored, writeStored } from "@/shared/lib/storage";
import { classNames } from "@/shared/lib/classNames";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import {
  iconFolder,
  iconFolderOpen,
  iconStar,
  iconPlus,
  iconChevronLeft,
  iconChevronRight,
  iconHammer,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import { SettingsButton } from "@/features/settings/components/SettingsButton";

interface WorkspaceSidebarProps {
  currentFolder?: string;
  onNavigate: (path?: string) => void;
  onOpenFolder: () => void;
  onCreateFolder: () => void;
  onOpenSettings: () => void;
  createDisabled: boolean;
}

// Medium windows default to the rail so the gallery keeps the width the old centred layout had.
const COLLAPSED_KEY = "workspace-sidebar-collapsed";
const COLLAPSED_MEDIUM_KEY = "workspace-sidebar-collapsed-medium";

function readCollapsed(key: string, fallback: boolean): boolean {
  const stored = readStored(key);
  return stored === null ? fallback : stored === "true";
}

export function WorkspaceSidebar({
  currentFolder,
  onNavigate,
  onOpenFolder,
  onCreateFolder,
  onOpenSettings,
  createDisabled,
}: WorkspaceSidebarProps) {
  const [collapsedWide, setCollapsedWide] = useState(() => readCollapsed(COLLAPSED_KEY, false));
  const [collapsedMedium, setCollapsedMedium] = useState(() =>
    readCollapsed(COLLAPSED_MEDIUM_KEY, true),
  );
  const [showNarrow, setShowNarrow] = useState(false);
  const narrow = useMediaQuery("(max-width: 1199px)");
  const medium = useMediaQuery("(max-width: 1599px)");
  const collapsed = medium ? collapsedMedium : collapsedWide;
  const hidden = narrow ? !showNarrow : collapsed;
  const overlay = narrow && !hidden;
  useEscapeKey(() => setShowNarrow(false), overlay);
  const favorites = useFolderFavorites().data ?? [];
  const toggleFavorite = useToggleFolderFavorite();
  const notify = useNotify();
  const recent = getRecentFoldersForPicker(
    currentFolder ?? "",
    favorites.map((entry) => entry.path),
  );
  const currentFavorite = favorites.some((entry) =>
    folderPathsEqual(entry.path, currentFolder ?? ""),
  );
  const toggle = () => {
    if (narrow) setShowNarrow(!showNarrow);
    else if (medium) {
      setCollapsedMedium(!collapsed);
      writeStored(COLLAPSED_MEDIUM_KEY, String(!collapsed));
    } else {
      setCollapsedWide(!collapsed);
      writeStored(COLLAPSED_KEY, String(!collapsed));
    }
  };
  const folderButton = (path: string, name: string) => (
    <button
      key={path}
      type="button"
      title={path}
      aria-label={name}
      className={classNames(
        "workspace-sidebar__folder",
        folderPathsEqual(path, currentFolder ?? "") && "workspace-sidebar__folder--active",
      )}
      onClick={() => {
        onNavigate(path);
        setShowNarrow(false);
      }}
    >
      <Icon icon={iconFolder} />
      <span>{name}</span>
    </button>
  );
  return (
    <aside
      className={classNames(
        "workspace-sidebar",
        hidden && "workspace-sidebar--collapsed",
        overlay && "workspace-sidebar--overlay",
      )}
      aria-label="Folder navigation"
    >
      {overlay && (
        <button
          type="button"
          className="workspace-sidebar__backdrop"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setShowNarrow(false)}
        />
      )}
      <div className="workspace-sidebar__panel">
        <div className="workspace-sidebar__heading">
          {!hidden && (
            <strong className="workspace-sidebar__brand">
              <Icon icon={iconHammer} />
              DataForge
            </strong>
          )}
          <button
            type="button"
            className="workspace-button workspace-button--icon"
            onClick={toggle}
            aria-label={hidden ? "Expand folder sidebar" : "Collapse folder sidebar"}
            aria-expanded={!hidden}
          >
            <Icon icon={hidden ? iconChevronRight : iconChevronLeft} />
          </button>
        </div>
        <Tooltip
          content={<ShortcutHint shortcut={SHORTCUTS.openFolder}>Open another folder</ShortcutHint>}
        >
          <button
            type="button"
            className="workspace-button"
            onClick={onOpenFolder}
            aria-label="Open folder"
            aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.openFolder)}
          >
            <Icon icon={iconFolderOpen} />
            {!hidden && "Open folder"}
          </button>
        </Tooltip>
        <SettingsButton onOpen={onOpenSettings} showLabel={!hidden} />
        {hidden ? (
          <div className="workspace-sidebar__scroll" />
        ) : (
          <div className="workspace-sidebar__scroll">
            <section aria-label="Favorite folders">
              <h2>Favorites</h2>
              {favorites.map((entry) => folderButton(entry.path, entry.name))}
              {favorites.length === 0 && <p>No favorite folders yet.</p>}
            </section>
            <section aria-label="Recent folders">
              <h2>Recent</h2>
              {recent.map((path) => folderButton(path, folderLeafName(path)))}
            </section>
          </div>
        )}
        {/* The rail keeps these as icons: the sidebar is the only place to create a folder. */}
        <div className="workspace-sidebar__footer">
          <button
            type="button"
            className="workspace-button"
            onClick={onCreateFolder}
            disabled={createDisabled}
            aria-label="New folder"
          >
            <Icon icon={iconPlus} />
            {!hidden && "New folder"}
          </button>
          <button
            type="button"
            className="workspace-button"
            disabled={!currentFolder || toggleFavorite.isPending}
            aria-label={currentFavorite ? "Unfavorite folder" : "Favorite folder"}
            onClick={() => {
              if (currentFolder)
                toggleFavorite.mutate(
                  { path: currentFolder, isFavorite: currentFavorite },
                  {
                    onError: (error) =>
                      notify({ variant: "danger", message: formatApiError(error) }),
                  },
                );
            }}
          >
            <Icon icon={iconStar} />
            {!hidden && (currentFavorite ? "Unfavorite folder" : "Favorite folder")}
          </button>
        </div>
      </div>
    </aside>
  );
}
