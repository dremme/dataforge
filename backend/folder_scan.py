"""One directory scan. Imports nothing but ``constants`` so it cannot cycle with ``filesystem``/``media_listing``."""

from __future__ import annotations

import os
from collections.abc import Container
from dataclasses import dataclass
from pathlib import Path

from constants import (
    COMFY_CANDIDATE_SUFFIX,
    GIF_EXTENSION,
    IMAGE_EXTENSIONS,
    SKIP_DIR_NAMES,
    STAGING_DIR_NAME,
    SYSPROMPT_FILENAME,
    VIDEO_EXTENSIONS,
)


@dataclass(frozen=True)
class ScannedEntry:
    """Both ``mtime`` and ``mtime_ns``: deriving one from the other loses precision and busts caches."""

    name: str
    path: Path
    mtime: float
    mtime_ns: int
    size: int


@dataclass(frozen=True)
class FolderScan:
    folder: Path
    files: dict[str, ScannedEntry]
    dirs: list[ScannedEntry]
    media: list[ScannedEntry]
    candidates: dict[str, ScannedEntry]
    sysprompt: ScannedEntry | None

    def sidecar(self, prefix: str, extension: str) -> ScannedEntry | None:
        """Captions hang off the stem; findings hang off the whole filename so ``clip.mp4`` and ``clip.png`` cannot share one."""
        return self.files.get(f"{prefix}{extension}")


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


def candidate_name_for(
    media_name: str, staged: Container[str], folder_names: Container[str]
) -> str | None:
    """The staged file this media claims, or None. One rule, so the listing and accept agree."""
    if media_name in staged:
        return media_name

    stem, dot, suffix = media_name.rpartition(".")
    if not dot or f".{suffix.lower()}" == COMFY_CANDIDATE_SUFFIX:
        return None

    staged_name = f"{stem}{COMFY_CANDIDATE_SUFFIX}"
    # A sibling of that exact name is its own media file, and owns the candidate outright.
    if staged_name in staged and staged_name not in folder_names:
        return staged_name

    return None


def _sort_key(entry: ScannedEntry) -> tuple[str, str]:
    # Secondary key: two names that differ only by case would otherwise be filesystem-order.
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


def _scan_staging_files(folder: Path) -> dict[str, ScannedEntry]:
    candidates: dict[str, ScannedEntry] = {}
    staging = folder / STAGING_DIR_NAME
    try:
        with os.scandir(staging) as entries:
            for entry in entries:
                try:
                    if not entry.is_file():
                        continue
                except OSError:
                    continue
                scanned = _entry_from_dir_entry(entry, staging)
                if scanned is not None:
                    candidates[scanned.name] = scanned
    except OSError:
        return {}
    return candidates


def scan_folder(folder: Path) -> FolderScan | None:
    """``None`` when the directory cannot be read."""
    files: dict[str, ScannedEntry] = {}
    dirs: list[ScannedEntry] = []
    media: list[ScannedEntry] = []
    sysprompt: ScannedEntry | None = None
    saw_staging = False

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
                    if entry.name == STAGING_DIR_NAME:
                        saw_staging = True
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
        candidates=_scan_staging_files(folder) if saw_staging else {},
        sysprompt=sysprompt,
    )


def folder_entries_in_order(scan: FolderScan) -> list[tuple[str, ScannedEntry]]:
    """Merged in directory order; concatenating the three collections would not match the fingerprint."""
    tagged: list[tuple[str, ScannedEntry]] = [("dir", entry) for entry in scan.dirs]
    tagged.extend(("media", entry) for entry in scan.media)
    if scan.sysprompt is not None:
        tagged.append(("sysprompt", scan.sysprompt))

    tagged.sort(key=lambda pair: _sort_key(pair[1]))
    return tagged
