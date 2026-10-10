"""Utility job to rename supported media files with a numbered stem prefix."""

from __future__ import annotations

import filecmp
import logging
import re
import shutil
from pathlib import Path

from automation.job_runner import ProgressCallback, ShouldCancel
from automation.selection import filter_media_list, list_folder_media
from candidate_pairing import candidate_path_for
from comfy_candidates import is_settling, read_candidate_sidecar, write_candidate_sidecar
from constants import MEDIA_EXTENSIONS
from edit_sidecars import is_rendering
from media_group import group_target, media_group_paths, shared_stem_paths

logger = logging.getLogger(__name__)


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
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="mtime")


def _repoint_candidate_record(source_media: Path, target_media: Path) -> None:
    """The record names its source, and processing refuses a candidate whose name disagrees."""
    candidate = candidate_path_for(target_media)
    record = read_candidate_sidecar(candidate) if candidate is not None else None
    if candidate is None or record is None or record.source_name != source_media.name:
        return
    write_candidate_sidecar(candidate, record.model_copy(update={"source_name": target_media.name}))


def _rename_media_group(source_media: Path, target_media: Path) -> None:
    """A file a same-stem sibling still shares is copied; an identical one already there merges."""
    shared = shared_stem_paths(source_media)
    # (original, target, copied): a copy is undone by removing it, not by renaming it back.
    renamed: list[tuple[Path, Path, bool]] = []
    try:
        for path in media_group_paths(source_media):
            target = group_target(source_media, target_media, path)
            if path in shared:
                shutil.copy2(path, target)
                renamed.append((path, target, True))
            elif path != source_media and target.is_file() and filecmp.cmp(path, target, False):
                # A sibling renamed earlier in the batch already carried this shared file here.
                path.unlink()
            else:
                path.rename(target)
                renamed.append((path, target, False))
        _repoint_candidate_record(source_media, target_media)
    except OSError:
        for original, target, copied in reversed(renamed):
            try:
                if copied:
                    target.unlink(missing_ok=True)
                else:
                    target.rename(original)
            except OSError:
                logger.exception("Failed to restore %s from %s", original, target)
        raise


def _check_target_conflict(target_path: Path, moving_sources: set[Path]) -> None:
    if not target_path.exists():
        return
    if target_path.resolve() in moving_sources:
        return
    raise ValueError(f'Cannot rename files: "{target_path.name}" already exists in this folder.')


def _validate_target_names(
    folder: Path, media_files: list[Path], stem: str, start_number: int
) -> None:
    if not media_files:
        return
    padding = sequence_padding(len(media_files), start_number)

    moving_sources: set[Path] = set()
    for media_path in media_files:
        # A render or accept still running would write back under the old name afterwards.
        if is_rendering(media_path) or is_settling(media_path):
            raise ValueError(
                f'Cannot rename files: "{media_path.name}" is being edited or reviewed. '
                "Try again when it finishes."
            )
        for related in media_group_paths(media_path):
            moving_sources.add(related.resolve())

    for index, media_path in enumerate(media_files, start=start_number):
        target_media = folder / build_target_name(stem, index, padding, media_path.suffix.lower())
        _check_target_conflict(target_media, moving_sources)

        for related in media_group_paths(media_path):
            if related == media_path:
                continue
            _check_target_conflict(group_target(media_path, target_media, related), moving_sources)

        candidate = candidate_path_for(media_path)
        if candidate is not None:
            renamed = group_target(media_path, target_media, candidate)
            # A folder file of that exact name would own the candidate, and pairing would move.
            if renamed.name != target_media.name:
                _check_target_conflict(folder / renamed.name, moving_sources)


def validate_rename_media_folder(
    folder: Path,
    *,
    stem: str,
    start_number: int = 1,
    selected_paths: list[Path] | None = None,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

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

        temp_media = source_media.with_name(f"{_TEMP_PREFIX}{index}{source_media.suffix.lower()}")

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
