import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import {
  cacheFolderFavorites,
  getCachedFolderFavorites,
  optimisticallyAddFavorite,
  optimisticallyRemoveFavorite,
  refreshFolderFavoritesInBackground,
  syncAddFolderFavorite,
  syncRemoveFolderFavorite,
} from "@/features/folder/lib/folderFavorites";
import {
  getRecentFoldersForPicker,
  promoteRecentFolder,
  readRecentFolderPaths,
  restoreRecentFolders,
} from "@/features/folder/lib/folderPreferences";
import { ModalShell } from "@/shared/ui/ModalShell";
import { iconFolder, iconStar, iconStarPlusIcon, iconX } from "@/shared/icons";
import type { FolderFavorite } from "@/shared/types";
import {
  folderLeafName,
  folderPathsEqual,
  normalizeFolderPath,
} from "@/features/folder/lib/folderPath";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface OpenFolderModalProps {
  currentFolder: string;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

interface FolderRowProps {
  path: string;
  name: string;
  isFavorite: boolean;
  isCurrent?: boolean;
  onOpen: (path: string) => void;
  onToggleFavorite: (path: string, isFavorite: boolean) => void;
}

function FolderRow({
  path,
  name,
  isFavorite,
  isCurrent = false,
  onOpen,
  onToggleFavorite,
}: FolderRowProps) {
  return (
    <li className="open-folder-modal__row">
      <div
        className={classNames(
          "open-folder-modal__option",
          isCurrent && "open-folder-modal__option--current",
        )}
      >
        <button
          type="button"
          className="open-folder-modal__option-main"
          onClick={() => onOpen(path)}
          title={path}
        >
          <Icon icon={iconFolder} className="open-folder-modal__option-icon" />
          <span className="open-folder-modal__option-text">
            <span className="open-folder-modal__option-name">{name}</span>
            <span className="open-folder-modal__option-path" title={path}>
              <span>{path}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          className={classNames(
            "open-folder-modal__favorite",
            isFavorite && "open-folder-modal__favorite--active",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(path, isFavorite);
          }}
          aria-label={isFavorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
          aria-pressed={isFavorite}
          tabIndex={-1}
        >
          <Icon
            icon={isFavorite ? iconStar : iconStarPlusIcon}
            className="open-folder-modal__favorite-icon"
          />
        </button>
      </div>
    </li>
  );
}

export function OpenFolderModal({ currentFolder, onClose, onOpenFolder }: OpenFolderModalProps) {
  const inputId = useId();
  const favoritesTitleId = useId();
  const recentTitleId = useId();
  const [draftPath, setDraftPath] = useState(currentFolder);
  const [favorites, setFavorites] = useState<FolderFavorite[]>(() => getCachedFolderFavorites());
  const [recentRevision, setRecentRevision] = useState(0);
  const notify = useNotify();
  const syncingFavoritePathsRef = useRef(new Set<string>());
  const favoritesEpochRef = useRef(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const epochAtStart = favoritesEpochRef.current;

    refreshFolderFavoritesInBackground(
      (updatedFavorites) => {
        if (cancelled || favoritesEpochRef.current !== epochAtStart) return;
        setFavorites(updatedFavorites);
      },
      (message) => {
        if (cancelled) return;
        if (getCachedFolderFavorites().length === 0) {
          notify({ variant: "danger", message: formatApiError(new Error(message)) });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [notify]);

  const recentFolders = useMemo(
    () =>
      getRecentFoldersForPicker(
        currentFolder,
        favorites.map((favorite) => favorite.path),
      ),
    // recentRevision busts the cache when sessionStorage updates outside React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional cache buster
    [currentFolder, favorites, recentRevision],
  );

  const submitPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    onOpenFolder(trimmed);
    onClose();
  };

  const toggleFavorite = (path: string, isFavorite: boolean) => {
    const normalizedPath = normalizeFolderPath(path);
    if (!normalizedPath || syncingFavoritePathsRef.current.has(normalizedPath)) {
      return;
    }

    syncingFavoritePathsRef.current.add(normalizedPath);
    favoritesEpochRef.current += 1;

    const previousFavorites = favorites;
    const previousRecent = isFavorite ? readRecentFolderPaths() : null;
    const optimisticFavorites = isFavorite
      ? optimisticallyRemoveFavorite(favorites, path)
      : optimisticallyAddFavorite(favorites, path);

    setFavorites(optimisticFavorites);
    cacheFolderFavorites(optimisticFavorites);

    if (isFavorite) {
      promoteRecentFolder(path);
      setRecentRevision((revision) => revision + 1);
    }

    const request = isFavorite ? syncRemoveFolderFavorite(path) : syncAddFolderFavorite(path);

    void request
      .then((serverFavorites) => {
        setFavorites(serverFavorites);
        cacheFolderFavorites(serverFavorites);
      })
      .catch((error) => {
        setFavorites(previousFavorites);
        cacheFolderFavorites(previousFavorites);
        if (previousRecent) {
          restoreRecentFolders(previousRecent);
          setRecentRevision((revision) => revision + 1);
        }
        notify({ variant: "danger", message: formatApiError(error) });
      })
      .finally(() => {
        syncingFavoritePathsRef.current.delete(normalizedPath);
      });
  };

  return (
    <ModalShell
      block="open-folder-modal"
      labelledById="open-folder-modal-title"
      onClose={onClose}
      scrollLock="open-folder-modal-open"
      backdropLabel="Close folder picker"
      panelRef={panelRef}
      // The path field is what the picker is for; the lists below are a
      // shortcut, not the primary input.
      initialFocusRef={pathInputRef}
    >
      <header className="open-folder-modal__header">
        <h2 id="open-folder-modal-title" className="open-folder-modal__title">
          Open folder
        </h2>
        <button
          type="button"
          className="open-folder-modal__close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon icon={iconX} />
        </button>
      </header>

      <div className="open-folder-modal__composer">
        <form
          className="open-folder-modal__form"
          onSubmit={(event) => {
            event.preventDefault();
            submitPath(draftPath);
          }}
        >
          <label htmlFor={inputId} className="open-folder-modal__label">
            Folder path
          </label>
          <div className="open-folder-modal__input-row">
            <input
              ref={pathInputRef}
              id={inputId}
              type="text"
              className="open-folder-modal__input"
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder="C:\Users\you\Pictures"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="submit"
              className="open-folder-modal__submit"
              disabled={!draftPath.trim()}
              tabIndex={-1}
            >
              Open
            </button>
          </div>
        </form>
      </div>

      <div className="open-folder-modal__body" data-scroll-lock-allow>
        {favorites.length > 0 && (
          <section className="open-folder-modal__section" aria-labelledby={favoritesTitleId}>
            <h3 id={favoritesTitleId} className="open-folder-modal__section-title">
              Favorites
            </h3>
            <ul className="open-folder-modal__list">
              {favorites.map((favorite) => (
                <FolderRow
                  key={favorite.path}
                  path={favorite.path}
                  name={favorite.name}
                  isFavorite
                  isCurrent={folderPathsEqual(favorite.path, currentFolder)}
                  onOpen={submitPath}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}

        {recentFolders.length > 0 && (
          <section className="open-folder-modal__section" aria-labelledby={recentTitleId}>
            <h3 id={recentTitleId} className="open-folder-modal__section-title">
              Recent folders
            </h3>
            <ul className="open-folder-modal__list">
              {recentFolders.map((path) => (
                <FolderRow
                  key={path}
                  path={path}
                  name={folderLeafName(path)}
                  isFavorite={false}
                  isCurrent={folderPathsEqual(path, currentFolder)}
                  onOpen={submitPath}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </ModalShell>
  );
}
