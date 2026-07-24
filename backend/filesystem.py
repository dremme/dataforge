import os
import re
import string
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

from constants import LAST_FOLDER_KEY, SKIP_DIR_NAMES
from db import get_preference
from media_listing import summarize_folder_contents

_INVALID_FOLDER_NAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def get_home_folder() -> Path:
    return Path.home().resolve()


def list_folder_roots() -> list[dict[str, str]]:
    roots: list[dict[str, str]] = [{"name": "Home", "path": str(get_home_folder())}]

    if os.name == "nt":
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if Path(drive).exists():
                roots.append({"name": drive, "path": drive})
    else:
        roots.append({"name": "/", "path": "/"})

    return roots


def normalize_folder_path(path: str) -> Path:
    text = path.strip().replace("/", "\\")
    drive_root = re.fullmatch(r"([A-Za-z]:)(?:\\)?", text)
    if drive_root:
        return Path(f"{drive_root.group(1)}\\")

    return Path(text).expanduser().resolve()


def resolve_folder(path: str) -> Path:
    folder = normalize_folder_path(path)
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Folder not found")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return folder.resolve()


def is_listable_dir(entry: Path) -> bool:
    name = entry.name
    if name in SKIP_DIR_NAMES:
        return False
    return name not in {".", ".."}


def build_breadcrumbs(folder: Path) -> list[dict[str, str]]:
    folder = folder.resolve()
    chain: list[Path] = []
    current = folder
    while True:
        chain.append(current)
        parent = current.parent
        if parent == current:
            break
        current = parent
    chain.reverse()

    crumbs: list[dict[str, str]] = []
    for item in chain:
        name = item.drive if item.drive and item == Path(item.anchor) else item.name or str(item)
        crumbs.append({"name": name, "path": str(item)})
    return crumbs


def _subfolder_with_stats(entry: Path) -> dict[str, str | int]:
    return {
        "name": entry.name,
        "path": str(entry.resolve()),
        **summarize_folder_contents(entry),
    }


def sanitize_folder_name(name: str) -> str | None:
    if name != name.strip():
        return None

    cleaned = name.strip()
    if not cleaned or cleaned in {".", ".."}:
        return None

    if _INVALID_FOLDER_NAME_RE.search(cleaned):
        return None

    if cleaned.endswith((".", " ")):
        return None

    if cleaned.upper() in _WINDOWS_RESERVED_NAMES:
        return None

    return cleaned


def create_subfolder(parent: Path, name: str) -> dict[str, str | int]:
    folder_name = sanitize_folder_name(name)
    if folder_name is None:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    destination = parent / folder_name
    if destination.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")

    try:
        destination.mkdir()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {exc}") from exc

    return _subfolder_with_stats(destination.resolve())


def list_subfolders(folder: Path) -> list[dict[str, str | int]]:
    try:
        entries = [
            entry
            for entry in sorted(folder.iterdir(), key=lambda path: path.name.lower())
            if is_listable_dir(entry)
        ]
    except OSError:
        return []

    subfolder_entries: list[Path] = []
    for entry in entries:
        try:
            if entry.is_dir():
                subfolder_entries.append(entry)
        except OSError:
            continue

    if not subfolder_entries:
        return []

    max_workers = min(8, len(subfolder_entries))
    if max_workers <= 1:
        return [_subfolder_with_stats(entry) for entry in subfolder_entries]

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(_subfolder_with_stats, subfolder_entries))


class FolderExplorerError(Exception):
    """Raised when the folder cannot be opened in the OS file manager."""


class MediaPreviewError(Exception):
    """Raised when a file cannot be opened in the OS default viewer."""


def open_folder_in_file_manager(folder: Path) -> None:
    path = str(folder)

    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=True)
            return
        subprocess.run(["xdg-open", path], check=True)
    except FileNotFoundError as exc:
        raise FolderExplorerError("File manager is not available on this system") from exc
    except OSError as exc:
        raise FolderExplorerError(f"Failed to open folder: {exc}") from exc


def open_file_in_default_viewer(file_path: Path) -> None:
    path = str(file_path)

    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=True)
            return
        subprocess.run(["xdg-open", path], check=True)
    except FileNotFoundError as exc:
        raise MediaPreviewError("Default viewer is not available on this system") from exc
    except OSError as exc:
        raise MediaPreviewError(f"Failed to open file: {exc}") from exc


def resolve_initial_folder(path: str | None) -> Path:
    if path:
        return resolve_folder(path)

    saved = get_preference(LAST_FOLDER_KEY)
    if saved:
        saved_path = Path(saved)
        if saved_path.is_dir():
            return saved_path.resolve()

    return get_home_folder()
