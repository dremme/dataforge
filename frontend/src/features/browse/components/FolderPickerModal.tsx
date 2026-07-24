import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
} from "@/features/browse/lib/folderFavorites";
import {
  getRecentFoldersForPicker,
  promoteRecentFolder,
  readRecentFolderPaths,
  restoreRecentFolders,
} from "@/features/browse/lib/folderPreferences";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconFolder, iconStar, iconStarPlusIcon, iconX } from "@/shared/icons";
import type { FolderFavorite } from "@/shared/types";
import {
  folderLeafName,
  folderPathsEqual,
  normalizeFolderPath,
} from "@/features/browse/lib/folderPath";
import { Icon } from "@/shared/ui/Icon";

interface FolderPickerModalProps {
  currentFolder: string;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  title?: string;
  submitLabel?: string;
  disabledFolder?: string;
}

interface FolderPickerRowProps {
  path: string;
  name: string;
  isFavorite: boolean;
  isCurrent?: boolean;
  isDisabled?: boolean;
  onOpen: (path: string) => void;
  onToggleFavorite: (path: string, isFavorite: boolean) => void;
}

function FolderPickerRow({
  path,
  name,
  isFavorite,
  isCurrent = false,
  isDisabled = false,
  onOpen,
  onToggleFavorite,
}: FolderPickerRowProps) {
  return (
    <li className="folder-picker__row">
      <div
        className={`folder-picker__option${isCurrent ? " folder-picker__option--current" : ""}${isDisabled ? " folder-picker__option--disabled" : ""}`}
      >
        <button
          type="button"
          className="folder-picker__option-main"
          onClick={() => onOpen(path)}
          disabled={isDisabled}
          title={isDisabled ? "Cannot select the current folder" : path}
        >
          <Icon icon={iconFolder} className="folder-picker__option-icon" />
          <span className="folder-picker__option-text">
            <span className="folder-picker__option-name">{name}</span>
            <span className="folder-picker__option-path">{path}</span>
          </span>
        </button>
        <button
          type="button"
          className={`folder-picker__favorite${isFavorite ? " folder-picker__favorite--active" : ""}`}
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
            className="folder-picker__favorite-icon"
          />
        </button>
      </div>
    </li>
  );
}

export function FolderPickerModal({
  currentFolder,
  onClose,
  onOpenFolder,
  title = "Open folder",
  submitLabel = "Open",
  disabledFolder,
}: FolderPickerModalProps) {
  const inputId = useId();
  const favoritesTitleId = useId();
  const recentTitleId = useId();
  const [draftPath, setDraftPath] = useState(currentFolder);
  const [favorites, setFavorites] = useState<FolderFavorite[]>(() => getCachedFolderFavorites());
  const [recentRevision, setRecentRevision] = useState(0);
  const notify = useNotify();
  const syncingFavoritePathsRef = useRef(new Set<string>());
  const favoritesEpochRef = useRef(0);

  useScrollLock(true, "folder-picker-open");

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    setRecentRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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

  const isDisabledFolder = (path: string) =>
    Boolean(disabledFolder && folderPathsEqual(path, disabledFolder));

  const submitPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || isDisabledFolder(trimmed)) return;
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

  return createPortal(
    <div className="folder-picker" role="presentation">
      <button
        type="button"
        className="folder-picker__backdrop"
        aria-label="Close folder picker"
        onClick={onClose}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="folder-picker__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
      >
        <header className="folder-picker__header">
          <h2 id="folder-picker-title" className="folder-picker__title">
            {title}
          </h2>
          <button
            type="button"
            className="folder-picker__close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <div className="folder-picker__composer">
          <form
            className="folder-picker__form"
            onSubmit={(event) => {
              event.preventDefault();
              submitPath(draftPath);
            }}
          >
            <label htmlFor={inputId} className="folder-picker__label">
              Folder path
            </label>
            <div className="folder-picker__input-row">
              <input
                id={inputId}
                type="text"
                className="folder-picker__input"
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                placeholder="C:\Users\you\Pictures"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="submit"
                className="folder-picker__submit"
                disabled={!draftPath.trim() || isDisabledFolder(draftPath)}
                tabIndex={-1}
              >
                {submitLabel}
              </button>
            </div>
          </form>
        </div>

        <div className="folder-picker__body" data-scroll-lock-allow>
          {favorites.length > 0 && (
            <section className="folder-picker__section" aria-labelledby={favoritesTitleId}>
              <h3 id={favoritesTitleId} className="folder-picker__section-title">
                Favorites
              </h3>
              <ul className="folder-picker__list">
                {favorites.map((favorite) => (
                  <FolderPickerRow
                    key={favorite.path}
                    path={favorite.path}
                    name={favorite.name}
                    isFavorite
                    isCurrent={folderPathsEqual(favorite.path, currentFolder)}
                    isDisabled={isDisabledFolder(favorite.path)}
                    onOpen={submitPath}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </ul>
            </section>
          )}

          {recentFolders.length > 0 && (
            <section className="folder-picker__section" aria-labelledby={recentTitleId}>
              <h3 id={recentTitleId} className="folder-picker__section-title">
                Recent folders
              </h3>
              <ul className="folder-picker__list">
                {recentFolders.map((path) => (
                  <FolderPickerRow
                    key={path}
                    path={path}
                    name={folderLeafName(path)}
                    isFavorite={false}
                    isCurrent={folderPathsEqual(path, currentFolder)}
                    isDisabled={isDisabledFolder(path)}
                    onOpen={submitPath}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
