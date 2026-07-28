"""Helpers for running automation jobs on a subset of folder media."""

from __future__ import annotations

from pathlib import Path

from filesystem import normalize_user_path


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
