"""Deleting a media file together with every file tied to it by name.

The media is the operation: if it cannot be deleted nothing is. A related file that cannot be
deleted after it is reported as retained rather than failing the whole request, because the media
is already gone; :func:`delete_leftovers` retries those once whatever held them lets go.
"""

from __future__ import annotations

import os
from pathlib import Path

from constants import COMFY_STALE_SUFFIX, EDIT_STALE_SUFFIX
from file_trash import delete_path, deletes_to_trash, restore_from_trash
from media_claims import claim
from media_group import media_group_paths, shared_stem_paths


class MediaReappearedError(ValueError):
    """Raised when a cleanup finds the media back: its related files belong to it again."""


def _publish_leftovers(media: Path) -> list[Path]:
    """A failed publish's stale copy; a later folder sweep would move it back onto the name."""
    stale = (
        media.with_name(f"{media.name}{suffix}")
        for suffix in (EDIT_STALE_SUFFIX, COMFY_STALE_SUFFIX)
    )
    return [path for path in stale if path.is_file()]


def _delete_each(paths: list[Path]) -> tuple[list[Path], list[dict[str, str]]]:
    deleted: list[Path] = []
    retained: list[dict[str, str]] = []
    for path in paths:
        try:
            delete_path(path)
            deleted.append(path)
        except OSError as exc:
            retained.append({"path": str(path), "message": str(exc)})
    return deleted, retained


def _owned_paths(media: Path) -> set[str]:
    """Files tied to ``media`` by name and not shared with a same-stem sibling, normcased."""
    owned = {os.path.normcase(path) for path in media_group_paths(media)[1:]}
    owned |= {os.path.normcase(path) for path in _publish_leftovers(media)}
    return owned - {os.path.normcase(path) for path in shared_stem_paths(media)}


def delete_media_with_sidecars(file_path: Path) -> dict[str, object]:
    # Listed before the media goes: the candidate is found by pairing against the file itself.
    group = media_group_paths(file_path)
    with claim(group, "delete"):
        media, *related = group
        shared = shared_stem_paths(file_path)

        try:
            delete_path(media)
        except OSError as exc:
            raise OSError(f"Failed to delete {file_path.name}: {exc}") from exc

        deleted, retained = _delete_each(
            [path for path in related if path not in shared] + _publish_leftovers(file_path)
        )

    # Full paths, media first: what an undo hands back to `restore_media_with_sidecars`.
    recycled = [str(path) for path in (file_path, *deleted)] if deletes_to_trash() else []
    return {
        "path": str(file_path),
        "deleted": [file_path.name, *(path.name for path in deleted)],
        "retained": retained,
        "recycled": recycled,
    }


def delete_leftovers(media: Path, paths: list[Path]) -> dict[str, object]:
    """Retry deleting files a deleted ``media`` left behind.

    Only files still tied to ``media`` by name and not shared with a same-stem sibling qualify, so
    a stale request cannot delete anything another file owns.
    """
    group = media_group_paths(media)
    with claim(group, "delete"):
        if media.exists():
            raise MediaReappearedError(f"{media.name} exists again, so its files belong to it")

        owned = _owned_paths(media)
        foreign = next((path for path in paths if os.path.normcase(path) not in owned), None)
        if foreign is not None:
            raise ValueError(f"{foreign.name} is not a file {media.name} left behind")

        deleted, retained = _delete_each(paths)

    return {
        "path": str(media),
        "deleted": [path.name for path in deleted],
        "retained": retained,
        "recycled": [str(path) for path in deleted] if deletes_to_trash() else [],
    }


def restore_media_with_sidecars(media: Path, related: list[Path]) -> dict[str, object]:
    """Undo a delete: ``media`` back from the Recycle Bin, then whichever of its files came too.

    The media goes first because it decides what belongs to it. Ownership is only knowable once
    a file is back (the group lists files on disk), so each related file is restored, checked,
    and returned to the bin if it is not tied to the media by name: a request cannot pull back
    any other file the bin happens to hold.
    """
    restored: list[str] = []
    missing: list[str] = []
    failed: list[dict[str, str]] = []
    with claim([media, *related], "restore"):
        try:
            if not restore_from_trash(media):
                return {"restored": [], "missing": [str(media)], "failed": []}
        except OSError as exc:
            return {
                "restored": [],
                "missing": [],
                "failed": [{"path": str(media), "detail": str(exc)}],
            }
        restored.append(str(media))

        for path in related:
            try:
                if not restore_from_trash(path):
                    missing.append(str(path))
                    continue
                if os.path.normcase(path) not in _owned_paths(media):
                    delete_path(path)
                    failed.append({"path": str(path), "detail": f"Not a file of {media.name}"})
                    continue
            except OSError as exc:
                failed.append({"path": str(path), "detail": str(exc)})
                continue
            restored.append(str(path))

    return {"restored": restored, "missing": missing, "failed": failed}
