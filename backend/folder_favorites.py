import json
from pathlib import Path

from db import get_preference, set_preference
from filesystem import (
    folder_display_name,
    get_home_folder,
    normalize_user_path,
    resolve_folder,
)

FOLDER_FAVORITES_KEY = "folder_favorites"


def _parse_paths(raw: str) -> list[str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, list):
        return []

    return [entry for entry in data if isinstance(entry, str) and entry.strip()]


def _normalize_stored_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []

    for entry in paths:
        try:
            resolved = str(normalize_user_path(entry))
        except OSError:
            continue
        if resolved not in seen:
            seen.add(resolved)
            normalized.append(resolved)

    return normalized


def get_folder_favorite_paths() -> list[str]:
    raw = get_preference(FOLDER_FAVORITES_KEY)
    if raw is None:
        return [str(get_home_folder())]

    return _normalize_stored_paths(_parse_paths(raw))


def _save_paths(paths: list[str]) -> list[str]:
    normalized = _normalize_stored_paths(paths)
    set_preference(FOLDER_FAVORITES_KEY, json.dumps(normalized))
    return normalized


def list_folder_favorites() -> list[dict[str, str]]:
    home = get_home_folder()
    entries: list[dict[str, str]] = []

    for path_str in get_folder_favorite_paths():
        folder = Path(path_str)
        if not folder.is_dir():
            continue

        resolved = folder.resolve()
        name = "Home" if resolved == home else folder_display_name(resolved)
        entries.append({"path": str(resolved), "name": name})

    return entries


def add_folder_favorite(path: str) -> list[dict[str, str]]:
    folder = resolve_folder(path)
    folder_str = str(folder)
    paths = get_folder_favorite_paths()

    if folder_str not in paths:
        paths.append(folder_str)

    _save_paths(paths)
    return list_folder_favorites()


def remove_folder_favorite(path: str) -> list[dict[str, str]]:
    folder_str = str(normalize_user_path(path))
    paths = [entry for entry in get_folder_favorite_paths() if entry != folder_str]
    _save_paths(paths)
    return list_folder_favorites()
