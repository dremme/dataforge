from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import HTTPException

from captions import issue_file_path
from constants import SIDECAR_EXTENSIONS
from file_import import _existing_file_names
from media_delete import delete_media_with_sidecars

logger = logging.getLogger(__name__)


def related_media_paths(media_path: Path) -> list[Path]:
    paths = [media_path]

    for extension in SIDECAR_EXTENSIONS:
        sidecar = media_path.with_suffix(extension)
        if sidecar.is_file():
            paths.append(sidecar)

    issue_sidecar = issue_file_path(media_path)
    if issue_sidecar.is_file():
        paths.append(issue_sidecar)

    return paths


def preview_media_move(destination: Path, source_paths: list[Path]) -> dict[str, list[str]]:
    destination = destination.resolve()
    existing_names = _existing_file_names(destination)

    movable: list[str] = []
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
            movable.append(name)

    return {
        "movable": movable,
        "conflicts": conflicts,
        "skipped": skipped,
    }


def move_media_with_sidecars(
    source: Path,
    destination_folder: Path,
    *,
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

    if destination_media.exists():
        try:
            delete_media_with_sidecars(destination_media)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to replace existing file: {exc}",
            ) from exc

    moved: list[str] = []

    for path in related_media_paths(source):
        destination = destination_folder / path.name
        if destination.exists():
            try:
                destination.unlink()
            except OSError as exc:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to replace existing sidecar: {exc}",
                ) from exc

        try:
            shutil.move(str(path), str(destination))
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail=f"Failed to move {path.name}: {exc}"
            ) from exc

        moved.append(path.name)

    return {
        "source": str(source),
        "destination": str(destination_media),
        "moved": moved,
    }


def move_media_batch(
    destination_folder: Path,
    source_paths: list[Path],
    *,
    overwrite: bool = False,
) -> dict[str, list[object]]:
    preview = preview_media_move(destination_folder, source_paths)
    allowed_names = set(preview["movable"])
    if overwrite:
        allowed_names.update(preview["conflicts"])

    moved: list[dict[str, object]] = []
    skipped = list(preview["skipped"])
    failed: list[dict[str, str]] = []

    for source in source_paths:
        source = source.resolve()
        if source.name not in allowed_names:
            continue

        try:
            moved.append(
                move_media_with_sidecars(
                    source,
                    destination_folder,
                    overwrite=overwrite,
                )
            )
        except HTTPException as exc:
            failed.append({"path": str(source), "detail": str(exc.detail)})
        except OSError as exc:
            logger.warning("Failed to move %s: %s", source, exc)
            failed.append({"path": str(source), "detail": str(exc)})

    return {
        "moved": moved,
        "skipped": skipped,
        "failed": failed,
    }
