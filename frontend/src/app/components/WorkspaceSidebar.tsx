import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFavoriteDragOrder } from "@/features/folder/hooks/useFavoriteDragOrder";
import {
  useFolderFavorites,
  useToggleFolderFavorite,
} from "@/features/folder/hooks/useFolderFavorites";
import { useOpenFolderInNewTab } from "@/features/folder/hooks/useOpenFolderInNewTab";
import {
  forgetRecentFolder,
  getRecentFoldersForPicker,
  touchRecentFolder,
} from "@/features/folder/lib/folderPreferences";
import { folderLeafName, folderPathsEqual } from "@/features/folder/lib/folderPath";
import { FolderNoteDialog } from "@/features/folder/components/FolderNoteDialog";
import { useTaggingFolder } from "@/features/tagging/hooks/useTaggingFolder";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { readStored, writeStored } from "@/shared/lib/storage";
import { classNames } from "@/shared/lib/classNames";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import {
  iconFolder,
  iconFolderClock,
  iconFolderHeart,
  iconHeart,
  iconFolderPlus,
  iconFolderSearch,
  iconFileCog,
  iconStickyNote,
  iconStickyNotePlus,
  iconChevronLeft,
  iconChevronRight,
  iconClapperboard,
  iconHammer,
  iconX,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import { SettingsButton } from "@/features/settings/components/SettingsButton";

interface WorkspaceSidebarProps {
  currentFolder?: string;
  /** The open folder's note; blank when it has none. */
  note?: string;
  /** Whether the open folder has its own system prompt or caption rules. */
  hasInstructions?: boolean;
  onEditInstructions: () => void;
  onNavigate: (path?: string) => void;
  onCreateFolder: () => void;
  onOpenSettings: () => void;
  /** Starts an empty project in the open folder; off while no folder is open. */
  onOpenVideoEditor: () => void;
  videoEditorDisabled: boolean;
  createDisabled: boolean;
}

// Medium windows default to the rail so the gallery keeps most of the width.
const COLLAPSED_KEY = "workspace-sidebar-collapsed";
const COLLAPSED_MEDIUM_KEY = "workspace-sidebar-collapsed-medium";

function readCollapsed(key: string, fallback: boolean): boolean {
  const stored = readStored(key);
  return stored === null ? fallback : stored === "true";
}

export function WorkspaceSidebar({
  currentFolder,
  note = "",
  hasInstructions = false,
  onEditInstructions,
  onNavigate,
  onCreateFolder,
  onOpenSettings,
  onOpenVideoEditor,
  videoEditorDisabled,
  createDisabled,
}: WorkspaceSidebarProps) {
  const [collapsedWide, setCollapsedWide] = useState(() => readCollapsed(COLLAPSED_KEY, false));
  const [collapsedMedium, setCollapsedMedium] = useState(() =>
    readCollapsed(COLLAPSED_MEDIUM_KEY, true),
  );
  const [showNarrow, setShowNarrow] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const narrow = useMediaQuery("(max-width: 1199px)");
  const medium = useMediaQuery("(max-width: 1599px)");
  const collapsed = medium ? collapsedMedium : collapsedWide;
  const hidden = narrow ? !showNarrow : collapsed;
  const overlay = narrow && !hidden;
  useEscapeKey(() => setShowNarrow(false), overlay);
  const favorites = useFolderFavorites().data ?? [];
  const taggingFolder = useTaggingFolder();
  const toggleFavorite = useToggleFolderFavorite();
  const { dragProps, dragMark } = useFavoriteDragOrder(favorites);
  const notify = useNotify();
  const openInNewTab = useOpenFolderInNewTab();
  // The recent list lives in storage, outside React state; bumping this re-reads it.
  const [, setRecentRevision] = useState(0);
  const recent = getRecentFoldersForPicker(
    currentFolder ?? "",
    favorites.map((entry) => entry.path),
  );
  const currentFavorite = favorites.some((entry) =>
    folderPathsEqual(entry.path, currentFolder ?? ""),
  );
  const toggleLabel = hidden ? "Expand folder sidebar" : "Collapse folder sidebar";
  const favoriteLabel = currentFavorite ? "Unfavorite folder" : "Favorite folder";
  const noteLabel = note ? "Edit note" : "Add note";
  const instructionsLabel = hasInstructions ? "Edit instructions" : "Create instructions";
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
  const favoriteDragProps = (index: number): ButtonHTMLAttributes<HTMLButtonElement> => {
    const mark = dragMark(index);
    return {
      ...dragProps(index),
      className: classNames(mark && `workspace-sidebar__folder--${mark}`),
    };
  };
  const setFavorite = (path: string, isFavorite: boolean) => {
    // An unfavorited folder drops to the recent list rather than vanishing from the sidebar.
    if (isFavorite) {
      touchRecentFolder(path);
      setRecentRevision((revision) => revision + 1);
    }
    toggleFavorite.mutate(
      { path, isFavorite },
      { onError: (error) => notify({ variant: "danger", message: formatApiError(error) }) },
    );
  };
  const rowAction = (label: string, icon: ReactNode, onClick: () => void, active = false) => (
    <button
      key={label}
      type="button"
      className={classNames(
        "workspace-sidebar__row-action",
        active && "workspace-sidebar__row-action--active",
      )}
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  const folderRow = (key: string, button: ReactNode, actions: ReactNode[]) => (
    <div
      key={key}
      className={classNames(
        "workspace-sidebar__row",
        actions.length > 1 && "workspace-sidebar__row--two-actions",
      )}
    >
      {button}
      <div className="workspace-sidebar__row-actions">{actions}</div>
    </div>
  );
  const folderButton = (
    path: string,
    name: string,
    { className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> = {},
  ) => {
    const tagging = taggingFolder !== null && folderPathsEqual(path, taggingFolder);
    return (
      <Tooltip
        content={path}
        placement="right"
        className="workspace-sidebar__folder-tip"
        bubbleClassName="workspace-sidebar-path-tip"
      >
        <button
          {...props}
          {...openInNewTab(path)}
          type="button"
          aria-label={name}
          className={classNames(
            "workspace-sidebar__folder",
            folderPathsEqual(path, currentFolder ?? "") && "workspace-sidebar__folder--active",
            tagging && "workspace-sidebar__folder--tagging",
            className,
          )}
          onClick={() => {
            onNavigate(path);
            setShowNarrow(false);
          }}
        >
          <Icon icon={tagging ? iconFolderSearch : iconFolder} />
          <span>{name}</span>
        </button>
      </Tooltip>
    );
  };
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
          <Tooltip content={toggleLabel} placement="right">
            <button
              type="button"
              className="workspace-button workspace-button--icon"
              onClick={toggle}
              aria-label={toggleLabel}
              aria-expanded={!hidden}
            >
              <Icon icon={hidden ? iconChevronRight : iconChevronLeft} />
            </button>
          </Tooltip>
        </div>
        <Tooltip content="Open the video editor on a new project in this folder" placement="right">
          <button
            type="button"
            className="workspace-button"
            onClick={() => {
              onOpenVideoEditor();
              setShowNarrow(false);
            }}
            disabled={videoEditorDisabled}
            aria-label="Open video editor"
          >
            <Icon icon={iconClapperboard} />
            {!hidden && "Open video editor"}
          </button>
        </Tooltip>
        <SettingsButton onOpen={onOpenSettings} showLabel={!hidden} />
        {hidden ? (
          <div className="workspace-sidebar__scroll" />
        ) : (
          <div className="workspace-sidebar__scroll">
            <section aria-label="Favorite folders">
              <h2>
                <Icon icon={iconFolderHeart} />
                <span>Favorites</span>
              </h2>
              <div className="workspace-sidebar__folders">
                {favorites.map((entry, index) =>
                  folderRow(
                    entry.path,
                    folderButton(entry.path, entry.name, favoriteDragProps(index)),
                    [
                      rowAction(
                        `Unfavorite ${entry.name}`,
                        <Icon icon={iconHeart} />,
                        () => setFavorite(entry.path, true),
                        true,
                      ),
                    ],
                  ),
                )}
                {favorites.length === 0 && <p>No favorite folders yet.</p>}
              </div>
            </section>
            <section aria-label="Recent folders">
              <h2>
                <Icon icon={iconFolderClock} />
                <span>Recent</span>
              </h2>
              <div className="workspace-sidebar__folders">
                {recent.map((path) => {
                  const name = folderLeafName(path);
                  const actions = [
                    rowAction(`Favorite ${name}`, <Icon icon={iconHeart} />, () =>
                      setFavorite(path, false),
                    ),
                  ];
                  // The open folder heads the list whether stored or not, so it cannot be removed.
                  if (!folderPathsEqual(path, currentFolder ?? ""))
                    actions.push(
                      rowAction(`Remove ${name} from recent folders`, <Icon icon={iconX} />, () => {
                        forgetRecentFolder(path);
                        setRecentRevision((revision) => revision + 1);
                      }),
                    );
                  return folderRow(path, folderButton(path, name), actions);
                })}
              </div>
            </section>
          </div>
        )}
        {/* The rail keeps these as icons: the sidebar is the only place to create a folder. */}
        <div className="workspace-sidebar__footer">
          <Tooltip
            content={<ShortcutHint shortcut={SHORTCUTS.newFolder}>New folder</ShortcutHint>}
            placement="right"
          >
            <button
              type="button"
              className="workspace-button"
              onClick={onCreateFolder}
              disabled={createDisabled}
              aria-label="New folder"
              aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.newFolder)}
            >
              <Icon icon={iconFolderPlus} />
              {!hidden && "New folder"}
            </button>
          </Tooltip>
          {/* The label names the action; the accent heart shows the state in the rail. */}
          <Tooltip content={favoriteLabel} placement="right">
            <button
              type="button"
              className={classNames(
                "workspace-button",
                currentFavorite && "workspace-sidebar__favorite--active",
              )}
              disabled={!currentFolder || toggleFavorite.isPending}
              aria-label={favoriteLabel}
              onClick={() => {
                if (currentFolder) setFavorite(currentFolder, currentFavorite);
              }}
            >
              <Icon icon={iconHeart} />
              {!hidden && favoriteLabel}
            </button>
          </Tooltip>
          <Tooltip content="Show a note above this folder's gallery" placement="right">
            <button
              type="button"
              className="workspace-button"
              disabled={!currentFolder}
              aria-label={noteLabel}
              onClick={() => {
                setEditingNote(true);
                setShowNarrow(false);
              }}
            >
              <Icon icon={note ? iconStickyNote : iconStickyNotePlus} />
              {!hidden && noteLabel}
            </button>
          </Tooltip>
          <Tooltip
            content={
              hasInstructions
                ? "Edit the system prompt and caption rules for this folder"
                : "Create a system prompt or caption rules for this folder"
            }
            placement="right"
          >
            <button
              type="button"
              className="workspace-button"
              disabled={!currentFolder}
              aria-label={instructionsLabel}
              onClick={() => {
                onEditInstructions();
                setShowNarrow(false);
              }}
            >
              <Icon icon={iconFileCog} />
              {!hidden && instructionsLabel}
            </button>
          </Tooltip>
        </div>
      </div>
      {editingNote && currentFolder && (
        <FolderNoteDialog
          key={currentFolder}
          folderPath={currentFolder}
          initialText={note}
          onClose={() => setEditingNote(false)}
        />
      )}
    </aside>
  );
}
