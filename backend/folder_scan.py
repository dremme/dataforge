"""One directory scan, shared by listing, counting, and fingerprinting.

``os.scandir`` hands back the entry type and the stat data gathered during the
directory enumeration itself, so a single pass replaces the ``iterdir`` +
``is_file`` + ``stat`` + per-sidecar ``is_file`` probes each caller used to run
on its own. Sidecar existence becomes a dict hit against :attr:`FolderScan.files`
instead of a syscall, which is what a folder listing spends most of its time on.

This module deliberately imports nothing but ``constants`` — ``filesystem`` and
``media_listing`` both depend on it, so any import back the other way would cycle.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from constants import (
    GIF_EXTENSION,
    IMAGE_EXTENSIONS,
    SKIP_DIR_NAMES,
    SYSPROMPT_FILENAME,
    VIDEO_EXTENSIONS,
)


@dataclass(frozen=True)
class ScannedEntry:
    """A directory entry plus the stat data ``scandir`` already had in hand.

    ``mtime`` and ``mtime_ns`` are both kept: the API reports the float form and
    caches key off the integer one, and deriving either from the other loses
    precision in a way that would spuriously bust those caches.
    """

    name: str
    path: Path
    mtime: float
    mtime_ns: int
    size: int


@dataclass(frozen=True)
class FolderScan:
    """Everything a folder listing needs to know about one directory."""

    folder: Path
    #: Every regular file, keyed by exact name, for O(1) sidecar lookup.
    files: dict[str, ScannedEntry]
    #: Listable child directories, sorted by lowercased name.
    dirs: list[ScannedEntry]
    #: Media files, sorted by lowercased name. Excludes the sysprompt.
    media: list[ScannedEntry]
    sysprompt: ScannedEntry | None

    def sidecar(self, stem: str, extension: str) -> ScannedEntry | None:
        """The sidecar named ``<stem><extension>``, or ``None`` if absent."""
        return self.files.get(f"{stem}{extension}")


def get_media_type(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix == GIF_EXTENSION:
        return "gif"
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return None


def is_listable_dir_name(name: str) -> bool:
    if name in SKIP_DIR_NAMES:
        return False
    return name not in {".", ".."}


def _sort_key(entry: ScannedEntry) -> tuple[str, str]:
    # The secondary key keeps ordering deterministic when two names differ only
    # by case, which `scandir` order alone would leave up to the filesystem.
    return (entry.name.lower(), entry.name)


def _entry_from_dir_entry(entry: os.DirEntry, folder: Path) -> ScannedEntry | None:
    try:
        stat = entry.stat()
    except OSError:
        return None
    return ScannedEntry(
        name=entry.name,
        path=folder / entry.name,
        mtime=stat.st_mtime,
        mtime_ns=stat.st_mtime_ns,
        size=stat.st_size,
    )


def scan_folder(folder: Path) -> FolderScan | None:
    """Enumerate ``folder`` once. ``None`` when the directory cannot be read."""
    files: dict[str, ScannedEntry] = {}
    dirs: list[ScannedEntry] = []
    media: list[ScannedEntry] = []
    sysprompt: ScannedEntry | None = None

    try:
        with os.scandir(folder) as entries:
            for entry in entries:
                try:
                    is_dir = entry.is_dir()
                except OSError:
                    continue

                if is_dir:
                    if not is_listable_dir_name(entry.name):
                        continue
                    scanned = _entry_from_dir_entry(entry, folder)
                    if scanned is not None:
                        dirs.append(scanned)
                    continue

                try:
                    if not entry.is_file():
                        continue
                except OSError:
                    continue

                scanned = _entry_from_dir_entry(entry, folder)
                if scanned is None:
                    continue

                files[scanned.name] = scanned

                if scanned.name == SYSPROMPT_FILENAME:
                    sysprompt = scanned
                elif get_media_type(scanned.path) is not None:
                    media.append(scanned)
    except OSError:
        return None

    dirs.sort(key=_sort_key)
    media.sort(key=_sort_key)

    return FolderScan(
        folder=folder,
        files=files,
        dirs=dirs,
        media=media,
        sysprompt=sysprompt,
    )


def folder_entries_in_order(scan: FolderScan) -> list[tuple[str, ScannedEntry]]:
    """Dirs, sysprompt, and media as one name-ordered sequence with kind tags.

    The folder fingerprint hashes entries in directory order, so it needs the
    three collections merged back together rather than concatenated.
    """
    tagged: list[tuple[str, ScannedEntry]] = [("dir", entry) for entry in scan.dirs]
    tagged.extend(("media", entry) for entry in scan.media)
    if scan.sysprompt is not None:
        tagged.append(("sysprompt", scan.sysprompt))

    tagged.sort(key=lambda pair: _sort_key(pair[1]))
    return tagged
