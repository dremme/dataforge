"""The edit state an in-place media edit keeps beside the file it rewrites.

A file's edit state is its ``<name>.bak`` original and its ``<name>.edit.json`` record, both keyed
by the whole filename so same-stem siblings never share one. The record holds the spec the live
file was rendered from and the fingerprint of the file that render published. A live file that no
longer matches that fingerprint was replaced outside DataForge: the next apply or revert adopts it
as the new original instead of rendering over it from the old backup.

Every writer here must hold a :mod:`media_claims` claim on the media file.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from constants import (
    EDIT_BACKUP_SUFFIX,
    EDIT_SIDECAR_SUFFIX,
    EDIT_STALE_SUFFIX,
    EDIT_TEMP_SUFFIX,
)
from file_publish import publish_replacing, sweep_publish_leftovers
from file_trash import delete_path
from file_write import write_text_atomic
from media_claims import holds_claim, is_claimed

logger = logging.getLogger(__name__)

NO_BACKUP_MESSAGE = "No original is stored for this file"


class PublishedFingerprint(BaseModel):
    """Microseconds, like video-project sources: nanosecond mtimes do not survive a browser."""

    size: int
    modified_us: int


class EditRecord(BaseModel):
    spec: dict[str, Any]
    published: PublishedFingerprint


def backup_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_BACKUP_SUFFIX}")


def edit_spec_path(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_SIDECAR_SUFFIX}")


def temp_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_TEMP_SUFFIX}")


def stale_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_STALE_SUFFIX}")


def fingerprint_of(path: Path) -> PublishedFingerprint:
    stat = path.stat()
    return PublishedFingerprint(size=stat.st_size, modified_us=stat.st_mtime_ns // 1000)


def _read_record(media: Path) -> EditRecord | None:
    path = edit_spec_path(media)
    try:
        return EditRecord.model_validate_json(path.read_bytes())
    except OSError:
        return None
    except ValidationError:
        logger.warning("Ignoring unreadable edit record %s", path.name, exc_info=True)
        return None


def _write_record(media: Path, record: EditRecord) -> None:
    write_text_atomic(edit_spec_path(media), json.dumps(record.model_dump(), indent=2))


def _is_replaced(media: Path, record: EditRecord | None) -> bool:
    """Only a recorded fingerprint can say so; without a record the backup is trusted."""
    if record is None:
        return False
    try:
        return fingerprint_of(media) != record.published
    except OSError:
        return False


def _kept_backup(media: Path) -> Path | None:
    """The backup that still belongs to the live file, or ``None``."""
    backup = backup_path_for(media)
    if not backup.is_file() or _is_replaced(media, _read_record(media)):
        return None
    return backup


def has_backup(media: Path) -> bool:
    return _kept_backup(media) is not None


def original_path_for(media: Path) -> Path:
    """What an edit renders from: the kept backup, else the live file."""
    return _kept_backup(media) or media


def read_spec[SpecT: BaseModel](media: Path, model: type[SpecT]) -> SpecT | None:
    """``None`` for an unedited, unreadable or externally replaced file."""
    record = _read_record(media)
    if record is None or _is_replaced(media, record):
        return None
    try:
        return model.model_validate(record.spec)
    except ValidationError:
        logger.warning("Ignoring an edit spec %s cannot read", model.__name__, exc_info=True)
        return None


def _require_claim(media: Path) -> None:
    if not holds_claim(media):
        raise RuntimeError(f"{media.name} was written without claiming it")


def discard_edit_state(media: Path) -> None:
    """Send the backup and record to the bin; what an adopt or an accept over an edit wants."""
    for path in (backup_path_for(media), edit_spec_path(media)):
        if path.is_file():
            delete_path(path)


def adopt_if_replaced(media: Path) -> bool:
    """Make an externally replaced live file the new original. True if it was replaced."""
    _require_claim(media)
    if not backup_path_for(media).is_file() or not _is_replaced(media, _read_record(media)):
        return False
    logger.info("%s changed outside DataForge; adopting it as the original", media.name)
    discard_edit_state(media)
    return True


def refresh_published(media: Path) -> None:
    """Record an in-app rewrite of the live file that kept its edit lineage. A file with no
    edit state, such as a job's temp output, needs no claim."""
    record = _read_record(media)
    if record is None:
        return
    _require_claim(media)
    _write_record(media, record.model_copy(update={"published": fingerprint_of(media)}))


def publish_with_spec(temp_path: Path, media: Path, spec: BaseModel) -> None:
    """Publish a render and the spec it was made from, so neither outlives a failure of the other.

    The record goes first: a failed write leaves the live file untouched, and a failed publish
    puts the previous record back. ``os.replace`` keeps the temp file's size and mtime, so its
    fingerprint is the published file's.
    """
    _require_claim(media)
    spec_path = edit_spec_path(media)
    try:
        previous = spec_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        previous = None

    _write_record(media, EditRecord(spec=spec.model_dump(), published=fingerprint_of(temp_path)))
    try:
        publish_replacing(temp_path, media, stale_path_for(media))
    except Exception:
        with suppress(OSError):
            if previous is None:
                spec_path.unlink(missing_ok=True)
            else:
                write_text_atomic(spec_path, previous)
        raise


def sweep_edit_temp_files(folder: Path) -> None:
    sweep_publish_leftovers(
        folder, temp_suffix=EDIT_TEMP_SUFFIX, stale_suffix=EDIT_STALE_SUFFIX, is_busy=is_claimed
    )


@dataclass(frozen=True)
class EditStart:
    #: The file to render from.
    source: Path
    #: The live file had been replaced outside DataForge and is now the original.
    adopted: bool


def begin_edit(media: Path) -> EditStart:
    """Adopt a replaced file, then make sure an untouched original exists to render from.

    The backup is a copy, never a rename: a rename would make a streamed path vanish for the
    length of the render.
    """
    adopted = adopt_if_replaced(media)
    sweep_edit_temp_files(media.parent)

    backup = backup_path_for(media)
    if not backup.exists():
        pending = backup.with_name(f"{backup.name}-tmp")
        try:
            shutil.copy2(media, pending)
            os.replace(pending, backup)
        finally:
            with suppress(OSError):
                pending.unlink(missing_ok=True)

    return EditStart(source=backup, adopted=adopted)


def restore_backup(media: Path) -> bool:
    """Copy the backup back; it is only removed once the live file matches it.

    False when the live file had been replaced outside DataForge: it is adopted instead, so
    there is nothing left to revert to.
    """
    if adopt_if_replaced(media):
        return False

    backup = backup_path_for(media)
    if not backup.is_file():
        raise ValueError(NO_BACKUP_MESSAGE)

    sweep_edit_temp_files(media.parent)
    temp_path = temp_path_for(media)

    try:
        shutil.copy2(backup, temp_path)
        publish_replacing(temp_path, media, stale_path_for(media))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    with suppress(OSError):
        backup.unlink(missing_ok=True)
    with suppress(OSError):
        edit_spec_path(media).unlink(missing_ok=True)
    return True
