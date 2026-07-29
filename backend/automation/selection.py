"""Helpers for choosing which folder media an automation job runs on."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from filesystem import normalize_user_path

MediaOrder = Literal["mtime", "name"]


def _mtime_key(path: Path) -> tuple[float, str]:
    return (os.path.getmtime(path), path.name.lower())


def _name_key(path: Path) -> tuple[float, str]:
    return (0.0, path.name.lower())


def list_folder_media(
    folder: Path,
    extensions: set[str],
    *,
    order: MediaOrder = "name",
) -> list[Path]:
    """Files in ``folder`` with a matching suffix, in a stable processing order.

    ``mtime`` preserves the order the files were captured in, ``name`` is alphabetical.
    """
    try:
        entries = sorted(folder.iterdir(), key=_mtime_key if order == "mtime" else _name_key)
    except OSError:
        return []

    media: list[Path] = []
    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.suffix.lower() in extensions:
            media.append(entry)

    return media


def resolve_selected_media(folder: Path, paths: list[str] | None) -> list[Path] | None:
    """Resolve optional client paths. None means process all eligible files in the folder."""
    if not paths:
        return None

    folder_resolved = folder.expanduser().resolve()
    resolved: list[Path] = []

    for raw in paths:
        file_path = normalize_user_path(raw)
        if not file_path.is_file():
            raise ValueError(f"Media file not found: {raw}")
        try:
            file_path.relative_to(folder_resolved)
        except ValueError as exc:
            raise ValueError(f"Media file is outside the selected folder: {raw}") from exc
        resolved.append(file_path)

    return resolved


def filter_media_list(media_files: list[Path], selected: list[Path] | None) -> list[Path]:
    if selected is None:
        return media_files

    selected_set = {path.resolve() for path in selected}
    filtered = [media_path for media_path in media_files if media_path.resolve() in selected_set]
    if not filtered:
        raise ValueError("No matching media files found for the selection")
    return filtered
