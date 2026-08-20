"""The files an in-place media edit keeps beside the file it rewrites.

Every editor here works the same way: the untouched original is stored once as
``photo.jpg.bak``, every render reads *that* rather than the live file, and the spec that
produced the current file is kept in ``photo.edit.json``. A spec therefore always describes
the finished result rather than a step on top of the last one - changing one value and
applying again keeps the rest, and no edit ever re-encodes an encode.

Nothing in this module knows what kind of media it is holding. ``video_edit`` and
``image_edit`` both build on it, and ``media_delete``, ``media_transfer`` and
``media_listing`` all reach for the path helpers so an edited file's sidecars are deleted,
carried and reported along with it.
"""

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
    """Hold the one render slot for ``media``, yielding its cancellation check.

    A second request for the same file is refused rather than queued: the caller is a
    double-clicked Apply far more often than it is two people, and stacking renders onto
    one file would have the later one publish over the earlier one's result.
    """
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
    """Ask an in-flight render for ``media`` to stop. False if there is none."""
    with _renders_lock:
        cancelled = _renders.get(_render_key(media))

    if cancelled is None:
        return False

    cancelled.set()
    return True


def backup_path_for(media: Path) -> Path:
    """``clip.mp4`` -> ``clip.mp4.bak``, appended so siblings keep distinct backups."""
    return media.with_name(f"{media.name}{EDIT_BACKUP_SUFFIX}")


def edit_spec_path(media: Path) -> Path:
    return media.with_suffix(EDIT_SIDECAR_SUFFIX)


def temp_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_TEMP_SUFFIX}")


def stale_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{EDIT_STALE_SUFFIX}")


def read_spec[SpecT: BaseModel](media: Path, model: type[SpecT]) -> SpecT | None:
    """The edit that produced the current file, or None if it has never been edited."""
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
    """Drop what a hard kill left behind; this is a folder the user browses."""
    with suppress(OSError):
        for suffix in (EDIT_TEMP_SUFFIX, EDIT_STALE_SUFFIX):
            for leftover in folder.glob(f"*{suffix}"):
                leftover.unlink(missing_ok=True)


def ensure_backup(media: Path) -> Path:
    """Store the untouched original, once. An existing backup is never rewritten.

    A copy rather than a rename: the browser may be streaming ``media`` right now, and
    renaming it away would make its path vanish for the length of the render - which the
    folder watcher pushes, and which the open modal answers by closing itself.

    The copy lands on a temp name first, so a crash or a full disk cannot leave a
    truncated file sitting at the backup name, where nothing would ever notice it.
    """
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
    """Put the untouched original back and forget the edit that replaced it.

    The backup is copied rather than renamed so a failure to install it still leaves a
    recoverable original, and it is only removed once the live file matches it.
    """
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
