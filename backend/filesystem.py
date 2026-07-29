import os
import re
import string
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PureWindowsPath

from fastapi import HTTPException

from constants import LAST_FOLDER_KEY, SKIP_DIR_NAMES
from db import get_preference
from media_listing import summarize_folder_contents

_INVALID_FOLDER_NAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_DRIVE_ROOT = re.compile(r"^([A-Za-z]:)[\\/]*$")
_WINDOWS_ABS_PATH = re.compile(r"^[A-Za-z]:[\\/]")

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


# ---------------------------------------------------------------------------
# Path handling (single entry point for host + cross-OS path strings)
# ---------------------------------------------------------------------------


def looks_like_windows_path(path: str) -> bool:
    """True for drive roots / absolute Windows paths (``C:\\...`` or ``C:/...``)."""
    text = path.strip()
    if not text:
        return False
    if _WINDOWS_DRIVE_ROOT.fullmatch(text.replace("/", "\\")):
        return True
    return bool(_WINDOWS_ABS_PATH.match(text))


def normalize_user_path(path: str) -> Path:
    """Resolve a client path string against the **host** filesystem.

    - Windows: accept ``/`` or ``\\``, uppercase bare drive roots (``c:`` → ``C:\\``).
    - POSIX: leave ``/`` alone (never convert to ``\\`` — that breaks real paths/CI).
    """
    text = path.strip()
    if not text:
        return Path.cwd().resolve()

    if os.name == "nt":
        text = text.replace("/", "\\")
        drive_root = re.fullmatch(r"([A-Za-z]:)(?:\\)?", text)
        if drive_root:
            return Path(f"{drive_root.group(1).upper()}\\")
        return Path(text).expanduser().resolve()

    return Path(text).expanduser().resolve()


def normalize_folder_path(path: str) -> Path:
    """Alias for :func:`normalize_user_path` (folders and files share the same rules)."""
    return normalize_user_path(path)


def path_leaf_name(path: str | Path) -> str:
    """Last path segment, safe for Windows-style strings on any host OS.

    ``Path(r"C:\\\\a\\\\b").name`` is wrong on POSIX (``\\\\`` is not a separator).
    Prefer :class:`~pathlib.PureWindowsPath` when the string looks Windows-like.
    """
    text = str(path).strip()
    if not text:
        return ""

    if looks_like_windows_path(text) or "\\" in text:
        name = PureWindowsPath(text).name
        if name:
            return name

    name = Path(text).name
    return name or text


def preference_folder_key(path: str) -> str:
    """Stable preference-map key for a folder path.

    Host paths resolve on the host OS. Windows-style strings (including fixtures
    and Windows clients) stay Windows-shaped via :class:`~pathlib.PureWindowsPath`
    so write/read keys match on Linux CI.
    """
    text = path.strip()
    if not text:
        return text

    drive_root = _WINDOWS_DRIVE_ROOT.fullmatch(text.replace("/", "\\"))
    if drive_root:
        return f"{drive_root.group(1).upper()}\\"

    if os.name == "nt" or looks_like_windows_path(text):
        win = PureWindowsPath(text)
        if os.name == "nt":
            try:
                return str(Path(str(win)).expanduser().resolve())
            except OSError:
                pass
        return str(win)

    try:
        return str(normalize_user_path(text))
    except OSError:
        return text.rstrip("/")


def folder_display_name(path: str | Path) -> str:
    """Short UI label for a folder (drive root letter, else leaf name)."""
    if isinstance(path, Path):
        resolved = path
        if resolved.drive and resolved == Path(resolved.anchor):
            return resolved.drive
        return resolved.name or str(resolved)
    return path_leaf_name(path)


def resolve_folder(path: str) -> Path:
    """Normalize and require an existing directory (API helper)."""
    folder = normalize_user_path(path)
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
        crumbs.append({"name": folder_display_name(item), "path": str(item)})
    return crumbs


def _subfolder_with_stats(entry: Path) -> dict[str, str | int]:
    return {
        "name": entry.name,
        "path": str(entry.resolve()),
        **summarize_folder_contents(entry),
    }


def _iter_child_directories(folder: Path) -> list[Path]:
    """Immediate listable child directories, sorted by name (no content stats)."""
    try:
        entries = [
            entry
            for entry in sorted(folder.iterdir(), key=lambda path: path.name.lower())
            if is_listable_dir(entry)
        ]
    except OSError:
        return []

    child_dirs: list[Path] = []
    for entry in entries:
        try:
            if entry.is_dir():
                child_dirs.append(entry)
        except OSError:
            continue
    return child_dirs


def list_child_folders(folder: Path) -> list[dict[str, str]]:
    """Lightweight child folder list: name + path only (no media/caption scans)."""
    return [
        {"name": entry.name, "path": str(entry.resolve())}
        for entry in _iter_child_directories(folder)
    ]


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
    """Child folders with per-folder media/caption stats (for the main gallery browse)."""
    subfolder_entries = _iter_child_directories(folder)
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


def _open_with_os_handler(
    target: Path,
    *,
    error: type[Exception],
    unavailable: str,
    failed: str,
) -> None:
    """Hand a path to the OS default handler, reporting failures as ``error``."""
    path = str(target)

    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
            return
        if sys.platform == "darwin":
            subprocess.run(["open", path], check=True)
            return
        subprocess.run(["xdg-open", path], check=True)
    except FileNotFoundError as exc:
        raise error(unavailable) from exc
    except OSError as exc:
        raise error(f"{failed}: {exc}") from exc


def open_folder_in_file_manager(folder: Path) -> None:
    _open_with_os_handler(
        folder,
        error=FolderExplorerError,
        unavailable="File manager is not available on this system",
        failed="Failed to open folder",
    )


def open_file_in_default_viewer(file_path: Path) -> None:
    _open_with_os_handler(
        file_path,
        error=MediaPreviewError,
        unavailable="Default viewer is not available on this system",
        failed="Failed to open file",
    )


def resolve_initial_folder(path: str | None) -> Path:
    if path:
        return resolve_folder(path)

    saved = get_preference(LAST_FOLDER_KEY)
    if saved:
        try:
            saved_path = normalize_user_path(saved)
        except OSError:
            saved_path = None
        if saved_path is not None and saved_path.is_dir():
            return saved_path.resolve()

    return get_home_folder()
