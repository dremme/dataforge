"""Utility job to rename supported media files with a numbered stem prefix."""

from __future__ import annotations

import argparse
import logging
import re
from collections.abc import Callable
from pathlib import Path

from automation.selection import filter_media_list, list_folder_media
from constants import MEDIA_EXTENSIONS
from logging_config import configure_logging, log_job_summary
from media_transfer import related_media_paths, sidecar_suffix

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

_INVALID_STEM_PATTERN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_TEMP_PREFIX = ".__df_rename_media_"


def normalize_name_stem(stem: str) -> str:
    trimmed = (stem or "").strip()
    if not trimmed:
        raise ValueError("Name stem cannot be empty")
    if _INVALID_STEM_PATTERN.search(trimmed):
        raise ValueError("Name stem contains invalid characters")
    if trimmed in {".", ".."}:
        raise ValueError("Name stem is not valid")
    return trimmed


def sequence_padding(count: int) -> int:
    return max(3, len(str(count)))


def build_target_name(stem: str, index: int, padding: int, suffix: str) -> str:
    return f"{stem}_{index:0{padding}d}{suffix}"


def list_rename_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="mtime")


def _target_for(source_media: Path, target_media: Path, related: Path) -> Path:
    """Where ``related`` (the media file or one of its sidecars) lands after the rename."""
    if related == source_media:
        return target_media
    return target_media.with_name(target_media.stem + sidecar_suffix(source_media, related))


def _rename_media_group(source_media: Path, target_media: Path) -> None:
    for path in related_media_paths(source_media):
        path.rename(_target_for(source_media, target_media, path))


def _check_target_conflict(target_path: Path, moving_sources: set[Path]) -> None:
    if not target_path.exists():
        return
    if target_path.resolve() in moving_sources:
        return
    raise ValueError(f'Cannot rename files: "{target_path.name}" already exists in this folder.')


def _validate_target_names(folder: Path, media_files: list[Path], stem: str) -> None:
    if not media_files:
        return
    padding = sequence_padding(len(media_files))

    moving_sources: set[Path] = set()
    for media_path in media_files:
        for related in related_media_paths(media_path):
            moving_sources.add(related.resolve())

    for index, media_path in enumerate(media_files, start=1):
        target_media = folder / build_target_name(stem, index, padding, media_path.suffix.lower())
        _check_target_conflict(target_media, moving_sources)

        for related in related_media_paths(media_path):
            if related == media_path:
                continue
            _check_target_conflict(_target_for(media_path, target_media, related), moving_sources)


def validate_rename_media_folder(
    folder: Path, *, stem: str, selected_paths: list[Path] | None = None
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    media_files = list_rename_media(folder)
    media_files = filter_media_list(media_files, selected_paths)
    if not media_files:
        raise ValueError("No supported images or videos found in folder")

    normalized_stem = normalize_name_stem(stem)
    _validate_target_names(folder, media_files, normalized_stem)


def _rollback_temp_entries(temp_entries: list[tuple[Path, Path, Path]]) -> None:
    for original_media, temp_media, _target_media in reversed(temp_entries):
        if not temp_media.exists():
            continue
        try:
            _rename_media_group(temp_media, original_media)
        except OSError:
            logger.exception("Failed to roll back temporary rename for %s", temp_media)


def _rollback_after_phase2_failure(
    temp_entries: list[tuple[Path, Path, Path]],
    completed_count: int,
) -> None:
    for _original_media, temp_media, target_media in reversed(temp_entries[:completed_count]):
        if target_media.exists():
            try:
                _rename_media_group(target_media, temp_media)
            except OSError:
                logger.exception("Failed to roll back final rename for %s", target_media)
    _rollback_temp_entries(temp_entries)


def run_rename_media_job(
    folder: Path,
    *,
    stem: str,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    normalized_stem = normalize_name_stem(stem)
    validate_rename_media_folder(folder, stem=normalized_stem, selected_paths=selected_paths)

    media_files = filter_media_list(list_rename_media(folder), selected_paths)
    total = len(media_files)
    padding = sequence_padding(total)
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
        for index, media_path in enumerate(media_files, start=1)
    ]

    # Two rename passes per file (to temp, then to final). Report one continuous
    # progress range so the UI does not fill to 100% after phase 1 and again after phase 2.
    progress_total = total * 2

    for index, (source_media, target_media) in enumerate(plan, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            _rollback_temp_entries(temp_entries)
            break

        temp_media = source_media.with_name(f"{_TEMP_PREFIX}{index}{source_media.suffix.lower()}")
        if on_progress:
            on_progress(
                str(source_media),
                source_media.name,
                index,
                progress_total,
                dict(stats),
            )

        try:
            _rename_media_group(source_media, temp_media)
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
            _rollback_temp_entries(temp_entries)
            break

        result: dict[str, object] = {
            "path": str(target_media),
            "name": target_media.name,
            "status": "success",
        }

        try:
            _rename_media_group(temp_media, target_media)
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
                    total + index,
                    progress_total,
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
                total + index,
                progress_total,
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


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Rename supported media files in a folder with a numbered stem.",
    )
    parser.add_argument("folder", type=Path, help="Folder containing images and/or videos")
    parser.add_argument("--stem", required=True, help='Name stem, e.g. "portugal"')
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_rename_media_job(folder, stem=args.stem)
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=("success", "rename_error", "cancelled"),
    )
    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("rename_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
