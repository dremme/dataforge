"""Sidecars an in-place media edit keeps beside the file it rewrites."""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from pathlib import Path

from pydantic import BaseModel

from constants import (
    EDIT_BACKUP_SUFFIX,
    EDIT_SIDECAR_SUFFIX,
    EDIT_STALE_SUFFIX,
    EDIT_TEMP_SUFFIX,
)
from file_publish import publish_replacing

logger = logging.getLogger(__name__)

NO_BACKUP_MESSAGE = "No original is stored for this file"
BUSY_MESSAGE = "This file is already being edited"


class EditBusyError(Exception):
    """Raised when a render for the same file is already running."""


_renders: dict[str, threading.Event] = {}
_renders_lock = threading.Lock()


def _render_key(media: Path) -> str:
    return os.path.normcase(str(media))


@contextmanager
def render_slot(media: Path) -> Iterator[Callable[[], bool]]:
    """One render slot; a second request for the same file is refused rather than queued."""
    key = _render_key(media)
    cancelled = threading.Event()

    with _renders_lock:
        if key in _renders:
            raise EditBusyError(BUSY_MESSAGE)
        _renders[key] = cancelled

    try:
        yield cancelled.is_set
    finally:
        with _renders_lock:
            _renders.pop(key, None)


def cancel_render(media: Path) -> bool:
    """False if there is none."""
    with _renders_lock:
        cancelled = _renders.get(_render_key(media))

    if cancelled is None:
        return False

    cancelled.set()
    return True


def backup_path_for(media: Path) -> Path:
    """Appended so siblings keep distinct backups."""
    return media.with_name(f"{media.name}{EDIT_BACKUP_SUFFIX}")


def edit_spec_path(media: Path) -> Path:
    return media.with_suffix(EDIT_SIDECAR_SUFFIX)


def temp_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_TEMP_SUFFIX}")


def stale_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_STALE_SUFFIX}")


def read_spec[SpecT: BaseModel](media: Path, model: type[SpecT]) -> SpecT | None:
    path = edit_spec_path(media)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    try:
        return model.model_validate(json.loads(raw))
    except ValueError:
        logger.warning("Ignoring unreadable edit spec %s", path.name, exc_info=True)
        return None


def write_spec(media: Path, spec: BaseModel) -> None:
    edit_spec_path(media).write_text(json.dumps(spec.model_dump(), indent=2), encoding="utf-8")


def clear_spec(media: Path) -> None:
    with suppress(OSError):
        edit_spec_path(media).unlink(missing_ok=True)


def sweep_edit_temp_files(folder: Path) -> None:
    with suppress(OSError):
        for suffix in (EDIT_TEMP_SUFFIX, EDIT_STALE_SUFFIX):
            for leftover in folder.glob(f"*{suffix}"):
                leftover.unlink(missing_ok=True)


def ensure_backup(media: Path) -> Path:
    """Copy, never rewrite. A rename would make a streamed path vanish for the length of the render."""
    backup = backup_path_for(media)
    if backup.exists():
        return backup

    pending = backup.with_name(f"{backup.name}-tmp")
    try:
        shutil.copy2(media, pending)
        os.replace(pending, backup)
    finally:
        with suppress(OSError):
            pending.unlink(missing_ok=True)

    return backup


def restore_backup(media: Path) -> None:
    """Copy the backup back; it is only removed once the live file matches it."""
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
    clear_spec(media)
