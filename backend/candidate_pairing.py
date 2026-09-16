"""One rule pairing a media file with its staged candidate, so the listing, the fingerprint and accept cannot disagree."""

from __future__ import annotations

from collections.abc import Container
from pathlib import Path

from constants import COMFY_CANDIDATE_SIDECAR_SUFFIX, COMFY_CANDIDATE_SUFFIXES, STAGING_DIR_NAME


def candidate_sidecar_path(candidate: Path) -> Path:
    return candidate.with_name(f"{candidate.name}{COMFY_CANDIDATE_SIDECAR_SUFFIX}")


def candidate_name_for(
    media_name: str, staged: Container[str], folder_names: Container[str]
) -> str | None:
    """The staged file this media claims, or None. One rule, so the listing and accept agree."""
    if media_name in staged:
        return media_name

    stem, dot, suffix = media_name.rpartition(".")
    if not dot:
        return None

    own_suffix = f".{suffix.lower()}"
    for candidate_suffix in COMFY_CANDIDATE_SUFFIXES:
        # Its own suffix is the exact-name case above; reaching here means that file is not staged.
        if candidate_suffix == own_suffix:
            continue

        staged_name = f"{stem}{candidate_suffix}"
        # A sibling of that exact name is its own media file, and owns the candidate outright.
        if staged_name in staged and staged_name not in folder_names:
            return staged_name

    return None


def candidate_path_for(media: Path) -> Path | None:
    """The same rule against the filesystem, for the settle path, which has no scan to consult."""
    staging = media.parent / STAGING_DIR_NAME
    name = candidate_name_for(
        media.name, _DirectoryNames(staging, files_only=True), _DirectoryNames(media.parent)
    )
    return staging / name if name is not None else None


class _DirectoryNames:
    """A directory as a lazy name lookup, so the scan rule above answers for the filesystem too."""

    def __init__(self, folder: Path, *, files_only: bool = False) -> None:
        self.folder = folder
        self.files_only = files_only

    def __contains__(self, name: object) -> bool:
        if not isinstance(name, str):
            return False
        path = self.folder / name
        return path.is_file() if self.files_only else path.exists()
