"""Staged ComfyUI results, and the accept/reject that settles them. Accept is refused while a ``.bak`` exists."""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from automation.find_duplicates import difference_hash, hamming_distance
from captions import issue_file_path
from constants import (
    COMFY_CANDIDATE_SIDECAR_SUFFIX,
    COMFY_CANDIDATE_SUFFIX,
    COMFY_STALE_SUFFIX,
    COMFY_TEMP_SUFFIX,
    STAGING_DIR_NAME,
)
from duplicates import duplicate_file_path
from edit_sidecars import backup_path_for
from file_publish import publish_replacing
from media_delete import delete_path
from media_dimensions import media_dimensions
from schemas import ComfyCandidateResponse, ComfyCandidateSidecar, ComfyCandidateStateResponse

logger = logging.getLogger(__name__)

NO_CANDIDATE_MESSAGE = "There is no candidate for this image"
BUSY_MESSAGE = "This candidate is already being settled"
EDITED_MESSAGE = (
    "This image has an unreverted edit. Revert it in the image editor, then accept the candidate."
)


#: Finer than the duplicate finder's 8 so a shifted subject lands in a different cell.
CANDIDATE_HASH_SIZE = 16


class CandidateBusyError(Exception):
    """Raised when the same file is already being accepted or rejected."""


class NoCandidateError(Exception):
    """Raised when the staging folder holds nothing for this file."""


_settling: dict[str, None] = {}
_settling_lock = threading.Lock()


def _settle_key(media: Path) -> str:
    return os.path.normcase(str(media))


@contextmanager
def settle_slot(media: Path) -> Iterator[None]:
    """One accept/reject slot; a batch and a single accept must not publish over each other."""
    key = _settle_key(media)

    with _settling_lock:
        if key in _settling:
            raise CandidateBusyError(BUSY_MESSAGE)
        _settling[key] = None

    try:
        yield
    finally:
        with _settling_lock:
            _settling.pop(key, None)


def difference_percent(before: Image.Image, after: Image.Image) -> float:
    """Perceptual-hash disagreement as a percentage. Blind to sharpening; two unrelated images sit near 50%."""
    bits = CANDIDATE_HASH_SIZE * CANDIDATE_HASH_SIZE
    distance = hamming_distance(
        difference_hash(before, CANDIDATE_HASH_SIZE),
        difference_hash(after, CANDIDATE_HASH_SIZE),
    )
    return round(distance / bits * 100, 1)


def candidate_difference(source: Path, candidate: Path) -> float | None:
    """:func:`difference_percent` for two files, or None when either cannot be read. Never raises."""
    try:
        with Image.open(source) as before, Image.open(candidate) as after:
            before.load()
            after.load()
            return difference_percent(before, after)
    except (OSError, UnidentifiedImageError) as error:
        # No traceback: a missing or undecodable file is ordinary here.
        logger.warning("Could not score %s against its candidate: %s", source.name, error)
        return None


def staging_dir(folder: Path) -> Path:
    return folder / STAGING_DIR_NAME


def candidate_write_path(media: Path) -> Path:
    """Where a new candidate is staged: ComfyUI writes PNG, so the stem pairs it, not the suffix."""
    return staging_dir(media.parent) / f"{media.stem}{COMFY_CANDIDATE_SUFFIX}"


def resolve_candidate(media: Path) -> Path | None:
    staging = staging_dir(media.parent)

    exact = staging / media.name
    if exact.is_file():
        return exact

    if media.suffix.lower() == COMFY_CANDIDATE_SUFFIX:
        return None

    staged = staging / f"{media.stem}{COMFY_CANDIDATE_SUFFIX}"
    if staged.is_file() and not (media.parent / staged.name).exists():
        return staged

    return None


def candidate_sidecar_path(candidate: Path) -> Path:
    return candidate.with_name(f"{candidate.name}{COMFY_CANDIDATE_SIDECAR_SUFFIX}")


def temp_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{COMFY_TEMP_SUFFIX}")


def stale_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{COMFY_STALE_SUFFIX}")


def has_candidate(media: Path) -> bool:
    return resolve_candidate(media) is not None


def sweep_comfy_temp_files(folder: Path) -> None:
    with suppress(OSError):
        for suffix in (COMFY_TEMP_SUFFIX, COMFY_STALE_SUFFIX):
            for leftover in folder.glob(f"*{suffix}"):
                leftover.unlink(missing_ok=True)


def write_candidate_sidecar(candidate: Path, sidecar: ComfyCandidateSidecar) -> None:
    candidate_sidecar_path(candidate).write_text(
        json.dumps(sidecar.model_dump(), indent=2), encoding="utf-8"
    )


def read_candidate_sidecar(candidate: Path) -> ComfyCandidateSidecar | None:
    path = candidate_sidecar_path(candidate)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    try:
        return ComfyCandidateSidecar.model_validate(json.loads(raw))
    except ValueError:
        logger.warning("Ignoring unreadable candidate record %s", path.name, exc_info=True)
        return None


def _describe(media: Path, *, accepted: bool, path: Path | None = None) -> ComfyCandidateResponse:
    stat = media.stat()
    dimensions = media_dimensions(media, "image", stat.st_mtime_ns, stat.st_size)
    return ComfyCandidateResponse(
        path=str(path if path is not None else media),
        accepted=accepted,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        width=dimensions[0] if dimensions else None,
        height=dimensions[1] if dimensions else None,
    )


def describe_candidate_state(media: Path) -> ComfyCandidateStateResponse:
    candidate = resolve_candidate(media)
    present = candidate is not None
    sidecar = read_candidate_sidecar(candidate) if candidate else None

    # Sidecar normally has the score; fallback is uncached so pre-score candidates still get one.
    difference = sidecar.difference_percent if sidecar else None
    if candidate and difference is None:
        difference = candidate_difference(media, candidate)

    return ComfyCandidateStateResponse(
        path=str(media),
        candidate_path=str(candidate) if candidate else None,
        has_candidate=present,
        preset=sidecar.preset if sidecar else None,
        prompt_id=sidecar.prompt_id if sidecar else None,
        seed=sidecar.seed if sidecar else None,
        difference_percent=difference,
        created_at=sidecar.created_at if sidecar else None,
    )


def _migrate_finding_sidecars(media: Path, target: Path) -> None:
    """Move the whole-filename findings onto the new name; the stem-based caption already matches."""
    for source_finding, target_finding in (
        (issue_file_path(media), issue_file_path(target)),
        (duplicate_file_path(media), duplicate_file_path(target)),
    ):
        if not source_finding.is_file():
            continue
        try:
            os.replace(source_finding, target_finding)
        except OSError as error:
            logger.warning("Failed to move %s onto %s: %s", source_finding.name, target.name, error)


def _discard_candidate(candidate: Path) -> None:
    for path in (candidate, candidate_sidecar_path(candidate)):
        if not path.is_file():
            continue
        try:
            delete_path(path)
        except OSError as error:
            logger.warning("Failed to discard %s: %s", path.name, error)


def accept_candidate(media: Path) -> ComfyCandidateResponse:
    """Publish the candidate in its own format, replacing the source whatever the source's extension.

    Refused while a ``.bak`` exists: image_edit renders from that file.
    """
    candidate = resolve_candidate(media)
    if candidate is None:
        raise NoCandidateError(NO_CANDIDATE_MESSAGE)

    if backup_path_for(media).is_file():
        raise ValueError(EDITED_MESSAGE)

    # The published file keeps the candidate's format (ComfyUI writes PNG), not the source's.
    target = media.with_suffix(candidate.suffix)

    with settle_slot(media):
        sweep_comfy_temp_files(media.parent)

        temp_path = temp_path_for(target)
        try:
            shutil.copy2(candidate, temp_path)
            publish_replacing(temp_path, target, stale_path_for(target))
        finally:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)

        if target != media:
            _migrate_finding_sidecars(media, target)
            with suppress(OSError):
                delete_path(media)

        _discard_candidate(candidate)

    return _describe(target, accepted=True)


def reject_candidate(media: Path) -> ComfyCandidateResponse:
    """Discard the staged candidate. The source may already be gone."""
    candidate = resolve_candidate(media)
    if candidate is None:
        raise NoCandidateError(NO_CANDIDATE_MESSAGE)

    with settle_slot(media):
        stats_from = media if media.is_file() else candidate
        described = _describe(stats_from, accepted=False, path=media)
        _discard_candidate(candidate)

    return described
