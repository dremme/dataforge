"""Renaming a media file together with every file tied to it by name."""

from __future__ import annotations

import filecmp
import logging
import os
import shutil
from functools import partial
from pathlib import Path

from fastapi import HTTPException

from candidate_pairing import candidate_path_for
from comfy_candidates import is_settling, read_candidate_sidecar, write_candidate_sidecar
from edit_sidecars import is_rendering
from file_write import retry_while_locked
from filesystem import sanitize_entry_name
from media_group import group_target, media_group_paths, shared_stem_paths

logger = logging.getLogger(__name__)

#: Names a file takes on its way to another, so no listing mistakes it for a media file.
RENAME_TEMP_PREFIX = ".__df_rename_media_"


def _repoint_candidate_record(source_media: Path, target_media: Path) -> None:
    """The record names its source, and processing refuses a candidate whose name disagrees."""
    candidate = candidate_path_for(target_media)
    record = read_candidate_sidecar(candidate) if candidate is not None else None
    if candidate is None or record is None or record.source_name != source_media.name:
        return
    write_candidate_sidecar(candidate, record.model_copy(update={"source_name": target_media.name}))


def rename_media_group(source_media: Path, target_media: Path) -> None:
    """A file a same-stem sibling still shares is copied; an identical one already there merges."""
    if source_media == target_media:
        # Every sidecar would compare equal to itself and be merged away.
        return
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
                retry_while_locked(path.unlink)
            else:
                retry_while_locked(partial(path.rename, target))
                renamed.append((path, target, False))
        _repoint_candidate_record(source_media, target_media)
    except OSError:
        for original, target, copied in reversed(renamed):
            try:
                if copied:
                    retry_while_locked(partial(target.unlink, missing_ok=True))
                else:
                    retry_while_locked(partial(target.rename, original))
            except OSError:
                logger.exception("Failed to restore %s from %s", original, target)
        raise


def check_not_busy(media: Path) -> None:
    # A render or accept still running would write back under the old name afterwards.
    if is_rendering(media) or is_settling(media):
        raise ValueError(
            f'Cannot rename files: "{media.name}" is being edited or reviewed. '
            "Try again when it finishes."
        )


def _check_target_conflict(target_path: Path, moving_sources: set[Path]) -> None:
    if not target_path.exists():
        return
    if target_path.resolve() in moving_sources:
        return
    raise ValueError(f'Cannot rename files: "{target_path.name}" already exists in this folder.')


def check_rename_conflicts(media: Path, target_media: Path, moving_sources: set[Path]) -> None:
    """Raises ``ValueError`` if a file of ``media``'s group would land on one that is staying.

    ``moving_sources`` holds every file about to move; a target may sit on one of those.
    """
    _check_target_conflict(target_media, moving_sources)

    for related in media_group_paths(media):
        if related == media:
            continue
        _check_target_conflict(group_target(media, target_media, related), moving_sources)

    candidate = candidate_path_for(media)
    if candidate is not None:
        renamed = group_target(media, target_media, candidate)
        # A folder file of that exact name would own the candidate, and pairing would move.
        if renamed.name != target_media.name:
            _check_target_conflict(target_media.parent / renamed.name, moving_sources)


def _rename_by_case_only(source_media: Path, target_media: Path) -> None:
    """On a case-insensitive disk both names compare equal, so a direct rename would do nothing."""
    hop = source_media.with_name(f"{RENAME_TEMP_PREFIX}{source_media.name}")
    rename_media_group(source_media, hop)
    try:
        rename_media_group(hop, target_media)
    except OSError:
        rename_media_group(hop, source_media)
        raise


def rename_media_file(source: Path, stem: str) -> dict[str, str]:
    """Give ``source`` the name ``stem`` plus its own extension, and its related files with it."""
    if sanitize_entry_name(stem) is None:
        raise HTTPException(status_code=400, detail="Invalid file name")

    target = source.with_name(stem + source.suffix)
    result = {"source": str(source), "destination": str(target)}
    # Compared as text: a path compares equal across a change of case on Windows.
    if target.name == source.name:
        return result

    try:
        check_not_busy(source)
        check_rename_conflicts(
            source, target, {path.resolve() for path in media_group_paths(source)}
        )
        if os.path.normcase(target) == os.path.normcase(source):
            _rename_by_case_only(source, target)
        else:
            rename_media_group(source, target)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to rename {source.name}: {exc}"
        ) from exc

    return result
