from __future__ import annotations

import errno
import logging
import os
import shutil
import tempfile
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
    try:
        os.replace(source, destination)
        return
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise

    try:
        shutil.copy2(source, destination)
        source.unlink()
    except OSError:
        remove_transfer_file(destination)
        raise


def transfer_one_file(source: Path, destination: Path, mode: TransferMode) -> None:
    if mode == "copy":
        try:
            shutil.copy2(source, destination)
        except OSError:
            remove_transfer_file(destination)
            raise
        return
    move_one_file(source, destination)


def remove_transfer_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Failed to remove transfer file %s: %s", path, exc)


def backup_transfer_destination(destination: Path) -> Path | None:
    if not destination.is_file():
        return None
    descriptor, name = tempfile.mkstemp(prefix=".transfer-backup-", dir=destination.parent)
    os.close(descriptor)
    backup = Path(name)
    try:
        os.replace(destination, backup)
    except OSError:
        remove_transfer_file(backup)
        raise
    return backup


def undo_transfer(done: list[tuple[Path, Path]], mode: TransferMode) -> set[Path]:
    unrestored: set[Path] = set()
    for origin, destination in reversed(done):
        try:
            if mode == "copy":
                destination.unlink(missing_ok=True)
            else:
                move_one_file(destination, origin)
        except OSError as exc:
            unrestored.add(destination)
            logger.warning("Failed to undo %s from %s to %s: %s", mode, origin, destination, exc)
    return unrestored


def restore_transfer_backups(backups: list[tuple[Path, Path]], unrestored: set[Path]) -> None:
    for destination, backup in reversed(backups):
        if destination in unrestored:
            logger.warning("Original destination %s preserved at %s", destination, backup)
            continue
        try:
            os.replace(backup, destination)
        except OSError as exc:
            logger.warning(
                "Failed to restore %s; backup retained at %s: %s", destination, backup, exc
            )


def discard_replaced_sidecars(destination_media: Path, arrived: set[Path]) -> None:
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
    backups: list[tuple[Path, Path]] = []
    created_dirs: list[Path] = []

    for path in media_group_paths(source):
        destination = group_target(source, destination_media, path)
        try:
            if not destination.parent.exists():
                destination.parent.mkdir()
                created_dirs.append(destination.parent)
            backup = backup_transfer_destination(destination)
            if backup is not None:
                backups.append((destination, backup))
            transfer_one_file(path, destination, mode)
        except OSError as exc:
            unrestored = undo_transfer(done, mode)
            restore_transfer_backups(backups, unrestored)
            for created in reversed(created_dirs):
                with suppress(OSError):
                    created.rmdir()
            raise HTTPException(
                status_code=500, detail=f"Failed to {mode} {path.name}: {exc}"
            ) from exc

        done.append((path, destination))

    for _, backup in backups:
        remove_transfer_file(backup)
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
