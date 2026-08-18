"""Move or copy media files together with the sidecars that belong to them.

Both directions share one path: they differ only in whether the source survives,
so only the per-file operation and the undo-on-failure step are mode-aware.
"""

from __future__ import annotations

import errno
import logging
import os
import shutil
from pathlib import Path
from typing import Literal

from fastapi import HTTPException

from captions import issue_file_path
from constants import SIDECAR_EXTENSIONS
from duplicates import duplicate_file_path
from file_import import _existing_file_names
from video_edit import backup_path_for, edit_spec_path

logger = logging.getLogger(__name__)

TransferMode = Literal["copy", "move"]


def related_media_paths(media_path: Path) -> list[Path]:
    """The media file plus every sidecar that belongs to it, in a stable order."""
    paths = [media_path]

    for extension in sorted(SIDECAR_EXTENSIONS):
        sidecar = media_path.with_suffix(extension)
        if sidecar.is_file():
            paths.append(sidecar)

    # Named explicitly for the same reason the issue and duplicate sidecars are: none of
    # these is one `with_suffix` away from the media name. The backup travels because a
    # file that arrives without it silently stops being revertible.
    for extra in (
        issue_file_path(media_path),
        duplicate_file_path(media_path),
        backup_path_for(media_path),
        edit_spec_path(media_path),
    ):
        if extra.is_file():
            paths.append(extra)

    return paths


def sidecar_suffix(media_path: Path, related: Path) -> str:
    """The part of ``related``'s name after the media stem, e.g. ``.issue.json``.

    ``Path.suffix`` only reports the last extension, so it would collapse
    ``photo.issue.json`` onto ``.json`` and collide with the caption sidecar.
    """
    return related.name[len(media_path.stem) :]


def preview_media_transfer(destination: Path, source_paths: list[Path]) -> dict[str, list[str]]:
    """Split ``source_paths`` into what can land, what collides, and what has nowhere to go.

    Mode-independent: a file already sitting in the destination can neither be
    moved there nor copied alongside itself, so both modes skip it.
    """
    destination = destination.resolve()
    existing_names = _existing_file_names(destination)

    eligible: list[str] = []
    conflicts: list[str] = []
    skipped: list[str] = []

    for source in source_paths:
        source = source.resolve()
        if source.parent.resolve() == destination:
            skipped.append(str(source))
            continue

        name = source.name
        if name in existing_names:
            conflicts.append(name)
        else:
            eligible.append(name)

    return {
        "eligible": eligible,
        "conflicts": conflicts,
        "skipped": skipped,
    }


def move_one_file(source: Path, destination: Path) -> None:
    """Move a single file, replacing ``destination``, without ever leaving a stray copy.

    ``shutil.move`` answers a failed rename by copying and then deleting the source. When
    the source cannot be deleted — on Windows, any other process holding it open blocks
    that — the copy stays at the destination while the original stays put, so one "moved"
    file ends up in both folders. Rename instead, and only copy for a genuine cross-volume
    move, undoing the copy when the original survives.
    """
    try:
        os.replace(source, destination)
        return
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise

    shutil.copy2(source, destination)
    try:
        source.unlink()
    except OSError:
        destination.unlink(missing_ok=True)
        raise


def transfer_one_file(source: Path, destination: Path, mode: TransferMode) -> None:
    if mode == "copy":
        shutil.copy2(source, destination)
        return
    move_one_file(source, destination)


def undo_transfer(done: list[tuple[Path, Path]], mode: TransferMode) -> None:
    """Unwind a half-finished group, so a failure never splits media from its sidecars.

    A move puts the originals back; a copy leaves them alone and drops what it wrote.
    """
    if mode == "copy":
        for _origin, destination in reversed(done):
            try:
                destination.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning(
                    "Failed to remove %s after an aborted copy: %s", destination.name, exc
                )
        return

    for origin, destination in reversed(done):
        try:
            os.replace(destination, origin)
        except OSError as exc:
            logger.warning("Failed to restore %s after an aborted move: %s", origin.name, exc)


def discard_replaced_sidecars(destination_media: Path, arrived_names: set[str]) -> None:
    """Drop sidecars of the replaced destination file that the source did not bring along.

    Runs only once the whole group has landed, so an aborted transfer never costs
    the destination the caption it already had.
    """
    for path in related_media_paths(destination_media):
        if path.name in arrived_names:
            continue
        try:
            path.unlink()
        except OSError as exc:
            logger.warning("Failed to remove replaced sidecar %s: %s", path.name, exc)


def transfer_media_with_sidecars(
    source: Path,
    destination_folder: Path,
    *,
    mode: TransferMode,
    overwrite: bool = False,
) -> dict[str, object]:
    source = source.resolve()
    destination_folder = destination_folder.resolve()

    if source.parent == destination_folder:
        raise HTTPException(status_code=400, detail="File is already in the destination folder")

    destination_media = destination_folder / source.name
    if destination_media.exists() and not overwrite:
        raise HTTPException(
            status_code=409,
            detail="File already exists in the destination folder",
        )

    done: list[tuple[Path, Path]] = []

    for path in related_media_paths(source):
        destination = destination_folder / path.name
        try:
            transfer_one_file(path, destination, mode)
        except OSError as exc:
            undo_transfer(done, mode)
            raise HTTPException(
                status_code=500, detail=f"Failed to {mode} {path.name}: {exc}"
            ) from exc

        done.append((path, destination))

    discard_replaced_sidecars(destination_media, {destination.name for _, destination in done})

    return {
        "source": str(source),
        "destination": str(destination_media),
        "files": [origin.name for origin, _ in done],
    }


def transfer_media_batch(
    destination_folder: Path,
    source_paths: list[Path],
    *,
    mode: TransferMode,
    overwrite: bool = False,
) -> dict[str, list[object]]:
    preview = preview_media_transfer(destination_folder, source_paths)
    allowed_names = set(preview["eligible"])
    if overwrite:
        allowed_names.update(preview["conflicts"])

    transferred: list[dict[str, object]] = []
    skipped = list(preview["skipped"])
    failed: list[dict[str, str]] = []

    for source in source_paths:
        source = source.resolve()
        if source.name not in allowed_names:
            continue

        try:
            transferred.append(
                transfer_media_with_sidecars(
                    source,
                    destination_folder,
                    mode=mode,
                    overwrite=overwrite,
                )
            )
        except HTTPException as exc:
            failed.append({"path": str(source), "detail": str(exc.detail)})
        except OSError as exc:
            logger.warning("Failed to %s %s: %s", mode, source, exc)
            failed.append({"path": str(source), "detail": str(exc)})

    return {
        "transferred": transferred,
        "skipped": skipped,
        "failed": failed,
    }
