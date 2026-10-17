"""Utility job to rename supported media files with a numbered stem prefix."""

from __future__ import annotations

import logging
import re
from pathlib import Path

from automation.job_runner import ProgressCallback, ShouldCancel
from automation.selection import filter_media_list, list_folder_media
from constants import MEDIA_EXTENSIONS
from media_group import media_group_paths
from media_rename import (
    RENAME_TEMP_PREFIX,
    check_not_busy,
    check_rename_conflicts,
    rename_media_group,
)

logger = logging.getLogger(__name__)


_INVALID_STEM_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def normalize_name_stem(stem: str) -> str:
    trimmed = (stem or "").strip()
    if not trimmed:
        raise ValueError("Name stem cannot be empty")
    if _INVALID_STEM_PATTERN.search(trimmed):
        raise ValueError("Name stem contains invalid characters")
    if trimmed in {".", ".."}:
        raise ValueError("Name stem is not valid")
    return trimmed


def normalize_start_number(start_number: object) -> int:
    # Arrives as JSON from a job's stored settings, so anything at all can turn up here.
    if isinstance(start_number, bool) or not isinstance(start_number, int | float | str):
        raise ValueError("Start number must be a whole number")
    try:
        value = int(start_number)
    except ValueError as exc:
        raise ValueError("Start number must be a whole number") from exc
    if value < 0:
        raise ValueError("Start number cannot be negative")
    return value


def sequence_padding(count: int, start_number: int = 1) -> int:
    """Digits wide enough for the highest number in the sequence, never fewer than three."""
    highest = max(start_number + count - 1, start_number)
    return max(3, len(str(highest)))


def build_target_name(stem: str, index: int, padding: int, suffix: str) -> str:
    return f"{stem}_{index:0{padding}d}{suffix}"


def list_rename_media(folder: Path) -> list[Path]:
    media = list_folder_media(folder, MEDIA_EXTENSIONS, order="mtime")
    return [path for path in media if not path.name.startswith(RENAME_TEMP_PREFIX)]


def _validate_target_names(
    folder: Path, media_files: list[Path], stem: str, start_number: int
) -> None:
    if not media_files:
        return
    padding = sequence_padding(len(media_files), start_number)

    moving_sources: set[Path] = set()
    for media_path in media_files:
        check_not_busy(media_path)
        for related in media_group_paths(media_path):
            moving_sources.add(related.resolve())

    for index, media_path in enumerate(media_files, start=start_number):
        target_media = folder / build_target_name(stem, index, padding, media_path.suffix.lower())
        check_rename_conflicts(media_path, target_media, moving_sources)


def validate_rename_media_folder(
    folder: Path,
    *,
    stem: str,
    start_number: int = 1,
    selected_paths: list[Path] | None = None,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    # Its original name is lost, and this run's temporary names would land on it.
    leftover = next((p for p in folder.iterdir() if p.name.startswith(RENAME_TEMP_PREFIX)), None)
    if leftover is not None:
        raise ValueError(
            f'Cannot rename files: "{leftover.name}" is left over from an interrupted rename. '
            "Rename or remove it first."
        )

    media_files = list_rename_media(folder)
    media_files = filter_media_list(media_files, selected_paths)
    if not media_files:
        raise ValueError("No supported images or videos found in folder")

    normalized_stem = normalize_name_stem(stem)
    normalized_start = normalize_start_number(start_number)
    _validate_target_names(folder, media_files, normalized_stem, normalized_start)


def _progress_files(step: int, total: int) -> int:
    # step runs 1..2N across the two passes; the UI counts files, not passes.
    return min(total, (step + 1) // 2)


def _rollback_temp_entries(temp_entries: list[tuple[Path, Path, Path]]) -> None:
    for original_media, temp_media, _target_media in reversed(temp_entries):
        if not temp_media.exists():
            continue
        try:
            rename_media_group(temp_media, original_media)
        except OSError:
            logger.exception("Failed to restore %s; it is left as %s", original_media, temp_media)


def _rollback_after_phase2_failure(
    temp_entries: list[tuple[Path, Path, Path]],
    completed_count: int,
) -> None:
    for original_media, temp_media, target_media in reversed(temp_entries[:completed_count]):
        if target_media.exists():
            try:
                rename_media_group(target_media, temp_media)
            except OSError:
                logger.exception(
                    "Failed to restore %s; it is left as %s", original_media, target_media
                )
    _rollback_temp_entries(temp_entries)


def run_rename_media_job(
    folder: Path,
    *,
    stem: str,
    start_number: int = 1,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    normalized_stem = normalize_name_stem(stem)
    normalized_start = normalize_start_number(start_number)
    validate_rename_media_folder(
        folder,
        stem=normalized_stem,
        start_number=normalized_start,
        selected_paths=selected_paths,
    )

    media_files = filter_media_list(list_rename_media(folder), selected_paths)
    total = len(media_files)
    padding = sequence_padding(total, normalized_start)
    stats: dict[str, int] = {
        "total": total,
        "success": 0,
        "rename_error": 0,
        "cancelled": 0,
    }
    file_results: list[dict[str, object]] = []
    temp_entries: list[tuple[Path, Path, Path]] = []

    plan = [
        (
            media_path,
            folder / build_target_name(normalized_stem, index, padding, media_path.suffix.lower()),
        )
        for index, media_path in enumerate(media_files, start=normalized_start)
    ]

    for index, (source_media, target_media) in enumerate(plan, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            _rollback_temp_entries(temp_entries)
            break

        temp_media = source_media.with_name(
            f"{RENAME_TEMP_PREFIX}{index}{source_media.suffix.lower()}"
        )

        try:
            rename_media_group(source_media, temp_media)
        except OSError as exc:
            stats["rename_error"] += 1
            file_results.append(
                {
                    "path": str(source_media),
                    "name": source_media.name,
                    "status": "rename_error",
                    "message": str(exc),
                }
            )
            _rollback_temp_entries(temp_entries)
            return {
                "folder": str(folder),
                "total": total,
                "processed": stats["rename_error"],
                "stats": stats,
                "results": file_results,
            }

        temp_entries.append((source_media, temp_media, target_media))
        if on_progress:
            on_progress(
                str(source_media),
                source_media.name,
                _progress_files(index, total),
                total,
                dict(stats),
            )

    if stats["cancelled"] or not temp_entries:
        processed = len(temp_entries) if stats["cancelled"] else 0
        return {
            "folder": str(folder),
            "total": total,
            "processed": processed,
            "stats": stats,
            "results": file_results,
        }

    for index, (original_media, temp_media, target_media) in enumerate(temp_entries, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            _rollback_after_phase2_failure(temp_entries, index - 1)
            break

        result: dict[str, object] = {
            "path": str(target_media),
            "name": target_media.name,
            "status": "success",
        }

        try:
            rename_media_group(temp_media, target_media)
            stats["success"] += 1
        except OSError as exc:
            stats["rename_error"] += 1
            result["status"] = "rename_error"
            result["message"] = str(exc)
            result["path"] = str(original_media)
            result["name"] = original_media.name
            file_results.append(result)
            _rollback_after_phase2_failure(temp_entries, index - 1)
            if on_progress:
                on_progress(
                    str(temp_media),
                    temp_media.name,
                    _progress_files(total + index, total),
                    total,
                    dict(stats),
                )
            return {
                "folder": str(folder),
                "total": total,
                "processed": stats["success"] + stats["rename_error"],
                "stats": stats,
                "results": file_results,
            }

        file_results.append(result)
        if on_progress:
            on_progress(
                str(target_media),
                target_media.name,
                _progress_files(total + index, total),
                total,
                dict(stats),
            )

    processed = stats["success"] + stats["rename_error"]
    return {
        "folder": str(folder),
        "total": total,
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }
