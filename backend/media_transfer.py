"""Move or copy media files together with the sidecars that belong to them."""

from __future__ import annotations

import errno
import logging
import os
import shutil
from collections.abc import Sequence
from contextlib import suppress
from pathlib import Path
from typing import Literal

from fastapi import HTTPException

from candidate_pairing import candidate_path_for
from file_import import _existing_file_names
from media_group import group_target, media_group_paths

logger = logging.getLogger(__name__)

TransferMode = Literal["copy", "move"]


def preview_media_transfer(destination: Path, source_paths: list[Path]) -> dict[str, list[str]]:
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
    """Rename, and only copy for a cross-volume move. ``shutil.move`` can leave a stray copy on Windows."""
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
    """Unwind a half-finished group so a failure never splits media from its sidecars."""
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


def discard_replaced_sidecars(destination_media: Path, arrived: set[Path]) -> None:
    """Drop destination sidecars the source did not bring. Runs only after the whole group has landed."""
    for path in media_group_paths(destination_media):
        if path in arrived:
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

    candidate = candidate_path_for(source)
    # A destination file of the candidate's exact name would claim it on arrival.
    if (
        candidate is not None
        and candidate.name != source.name
        and (destination_folder / candidate.name).exists()
    ):
        raise HTTPException(
            status_code=409,
            detail=f"Its staged candidate would pair with {candidate.name} in the destination",
        )

    done: list[tuple[Path, Path]] = []
    created_dirs: list[Path] = []

    for path in media_group_paths(source):
        destination = group_target(source, destination_media, path)
        try:
            # The backup and staging subfolders may not exist at the destination yet.
            if not destination.parent.exists():
                destination.parent.mkdir()
                created_dirs.append(destination.parent)
            transfer_one_file(path, destination, mode)
        except OSError as exc:
            undo_transfer(done, mode)
            for created in reversed(created_dirs):
                with suppress(OSError):
                    created.rmdir()
            raise HTTPException(
                status_code=500, detail=f"Failed to {mode} {path.name}: {exc}"
            ) from exc

        done.append((path, destination))

    discard_replaced_sidecars(destination_media, {destination for _, destination in done})

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
) -> dict[str, Sequence[object]]:
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
