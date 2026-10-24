"""Deleting a media file together with every file tied to it by name.

The media is the operation: if it cannot be deleted nothing is. A related file that cannot be
deleted after it is reported as retained rather than failing the whole request, because the media
is already gone; :func:`delete_leftovers` retries those once whatever held them lets go.
"""

from __future__ import annotations

import os
from pathlib import Path

from constants import COMFY_STALE_SUFFIX, EDIT_STALE_SUFFIX
from file_trash import delete_path
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


def _delete_each(paths: list[Path]) -> tuple[list[str], list[dict[str, str]]]:
    deleted: list[str] = []
    retained: list[dict[str, str]] = []
    for path in paths:
        try:
            delete_path(path)
            deleted.append(path.name)
        except OSError as exc:
            retained.append({"path": str(path), "message": str(exc)})
    return deleted, retained


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

    return {"path": str(file_path), "deleted": [file_path.name, *deleted], "retained": retained}


def delete_leftovers(media: Path, paths: list[Path]) -> dict[str, object]:
    """Retry deleting files a deleted ``media`` left behind.

    Only files still tied to ``media`` by name and not shared with a same-stem sibling qualify, so
    a stale request cannot delete anything another file owns.
    """
    group = media_group_paths(media)
    with claim(group, "delete"):
        if media.exists():
            raise MediaReappearedError(f"{media.name} exists again, so its files belong to it")

        owned = {os.path.normcase(path) for path in group[1:] + _publish_leftovers(media)}
        owned -= {os.path.normcase(path) for path in shared_stem_paths(media)}
        foreign = next((path for path in paths if os.path.normcase(path) not in owned), None)
        if foreign is not None:
            raise ValueError(f"{foreign.name} is not a file {media.name} left behind")

        deleted, retained = _delete_each(paths)

    return {"path": str(media), "deleted": deleted, "retained": retained}
