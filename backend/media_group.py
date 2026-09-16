"""Every file tied to a media file by its name, so rename, move and delete keep them together.

A file left behind is worse than clutter: backups and candidates pair by name, so a later file of
the same name would silently inherit them.
"""

from __future__ import annotations

from pathlib import Path

from candidate_pairing import candidate_path_for, candidate_sidecar_path
from captions import issue_file_path
from constants import CAPTION_BACKUP_DIR_NAME, CAPTION_SIDECAR_EXTENSIONS, SIDECAR_EXTENSIONS
from duplicates import duplicate_file_path
from edit_sidecars import backup_path_for, edit_spec_path


def media_group_paths(media: Path) -> list[Path]:
    """The media file first, then each related file that exists."""
    paths = [media]

    for extension in sorted(SIDECAR_EXTENSIONS):
        sidecar = media.with_suffix(extension)
        if sidecar.is_file():
            paths.append(sidecar)

    # Not `with_suffix` names: these are two suffixes deep or keep the whole filename.
    for extra in (
        issue_file_path(media),
        duplicate_file_path(media),
        backup_path_for(media),
        edit_spec_path(media),
    ):
        if extra.is_file():
            paths.append(extra)

    backup_dir = media.parent / CAPTION_BACKUP_DIR_NAME
    for extension in CAPTION_SIDECAR_EXTENSIONS:
        backed_up = backup_dir / f"{media.stem}{extension}"
        if backed_up.is_file():
            paths.append(backed_up)

    candidate = candidate_path_for(media)
    if candidate is not None:
        paths.append(candidate)
        record = candidate_sidecar_path(candidate)
        if record.is_file():
            paths.append(record)

    return paths


def sidecar_suffix(media: Path, related: Path) -> str:
    """The part after the media stem. ``Path.suffix`` would collapse ``photo.issue.json`` onto ``.json``."""
    return related.name[len(media.stem) :]


def group_target(media: Path, target_media: Path, related: Path) -> Path:
    """Where ``related`` lands when ``media`` becomes ``target_media``, keeping its subfolder."""
    if related == media:
        return target_media
    name = target_media.stem + sidecar_suffix(media, related)
    return target_media.parent / related.parent.relative_to(media.parent) / name
