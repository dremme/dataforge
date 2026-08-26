"""The staged results of a ComfyUI prep run, and the accept/reject that settles them.

A prep job never touches the dataset. It writes each result into ``<folder>/staging/``
under the source's own filename, beside a ``.comfy.json`` recording what produced it.
Nothing in the folder changes until the review queue accepts one, so a cancelled run, a
crashed run, or a preset that turned out to be wrong all cost nothing.

Accepting publishes the candidate under the real name and keeps no copy of what it
replaced: rejecting is the way back, and it comes before the accept. An accept is still
*refused* while a ``.bak`` exists, because the image editor renders every crop from that
file and would otherwise throw the accepted pass away - see :func:`accept_candidate`.
"""

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
from constants import (
    COMFY_CANDIDATE_SIDECAR_SUFFIX,
    COMFY_STALE_SUFFIX,
    COMFY_TEMP_SUFFIX,
    STAGING_DIR_NAME,
)
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


#: Side length of the grid the difference score is hashed on, finer than the duplicate
#: finder's 8. That grid answers "is this the same picture"; this one has to answer "did
#: the picture move", so its cells have to be small enough for a shifted subject to land
#: in a different one. 16 gives a 256-bit hash, still Pillow-only.
#:
#: It is not fine enough to see everything. On a 2048px image a cell is still ~128px, so
#: a mangled hand or a botched eye barely moves the number. The score says whether the
#: composition survived, which is what the review is for - it is not a defect detector,
#: and the images are shown side by side because it cannot be one.
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
    """Hold the one accept/reject slot for ``media``.

    A batch "accept remaining" and a single accept can otherwise reach the same path at
    once, and the loser would publish over the winner's result.
    """
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
    """How much of the two images' perceptual hash disagrees, as a percentage.

    Deliberately blind to the thing a prep run is *for*: a hash bit compares a pixel with
    its neighbour, so sharpening and added detail leave it where it was. What moves it is
    content moving, vanishing, or being reframed - which is the failure the review queue
    exists to catch.

    Scale-free by construction, so an upscale's 4x the pixels does not register on its
    own. Two unrelated images sit near 50%, that being where independent bits land.
    """
    bits = CANDIDATE_HASH_SIZE * CANDIDATE_HASH_SIZE
    distance = hamming_distance(
        difference_hash(before, CANDIDATE_HASH_SIZE),
        difference_hash(after, CANDIDATE_HASH_SIZE),
    )
    return round(distance / bits * 100, 1)


def candidate_difference(source: Path, candidate: Path) -> float | None:
    """:func:`difference_percent` for two files, or None when either cannot be read.

    Never raises. The score is a nicety on top of the state endpoint's real answer -
    whether a candidate is waiting at all - and an unreadable file must not cost the
    caller that.
    """
    try:
        with Image.open(source) as before, Image.open(candidate) as after:
            before.load()
            after.load()
            return difference_percent(before, after)
    except (OSError, UnidentifiedImageError) as error:
        # No traceback: a file that has moved or will not decode is an ordinary outcome
        # here, not the corrupt-record surprise the sidecar reader logs a stack for.
        logger.warning("Could not score %s against its candidate: %s", source.name, error)
        return None


def staging_dir(folder: Path) -> Path:
    return folder / STAGING_DIR_NAME


def candidate_path_for(media: Path) -> Path:
    """``<folder>/photo.png`` -> ``<folder>/staging/photo.png``.

    Same filename, which is what pairs the two everywhere: the review queue, accept, and
    every full-filename sidecar. A candidate saved under a different extension would
    orphan the caption, issue, duplicate and archive sidecars at once.
    """
    return staging_dir(media.parent) / media.name


def source_path_for(candidate: Path) -> Path:
    """The dataset file a candidate belongs to."""
    return candidate.parent.parent / candidate.name


def candidate_sidecar_path(candidate: Path) -> Path:
    return candidate.with_name(f"{candidate.name}{COMFY_CANDIDATE_SIDECAR_SUFFIX}")


def temp_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{COMFY_TEMP_SUFFIX}")


def stale_path_for(media: Path) -> Path:
    return media.with_name(f"{media.name}{COMFY_STALE_SUFFIX}")


def has_candidate(media: Path) -> bool:
    return candidate_path_for(media).is_file()


def sweep_comfy_temp_files(folder: Path) -> None:
    """Drop what a hard kill left behind; this is a folder the user browses."""
    with suppress(OSError):
        for suffix in (COMFY_TEMP_SUFFIX, COMFY_STALE_SUFFIX):
            for leftover in folder.glob(f"*{suffix}"):
                leftover.unlink(missing_ok=True)


def write_candidate_sidecar(candidate: Path, sidecar: ComfyCandidateSidecar) -> None:
    candidate_sidecar_path(candidate).write_text(
        json.dumps(sidecar.model_dump(), indent=2), encoding="utf-8"
    )


def read_candidate_sidecar(candidate: Path) -> ComfyCandidateSidecar | None:
    """What produced this candidate, or None when the record is missing or unreadable."""
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


def _describe(media: Path, *, accepted: bool) -> ComfyCandidateResponse:
    stat = media.stat()
    dimensions = media_dimensions(media, "image", stat.st_mtime_ns, stat.st_size)
    return ComfyCandidateResponse(
        path=str(media),
        accepted=accepted,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        width=dimensions[0] if dimensions else None,
        height=dimensions[1] if dimensions else None,
    )


def describe_candidate_state(media: Path) -> ComfyCandidateStateResponse:
    candidate = candidate_path_for(media)
    present = candidate.is_file()
    sidecar = read_candidate_sidecar(candidate) if present else None

    # The job scores the pair while both images are already decoded, so the sidecar
    # normally has the answer. Falling back to scoring the two files here is what gives
    # candidates staged before the score existed one anyway, without re-running a job
    # that takes hours. Uncached on purpose: two decodes, once per image the reviewer
    # actually opens, against the seconds they spend looking at it.
    difference = sidecar.difference_percent if sidecar else None
    if present and difference is None:
        difference = candidate_difference(media, candidate)

    return ComfyCandidateStateResponse(
        path=str(media),
        candidate_path=str(candidate) if present else None,
        has_candidate=present,
        preset=sidecar.preset if sidecar else None,
        prompt_id=sidecar.prompt_id if sidecar else None,
        seed=sidecar.seed if sidecar else None,
        difference_percent=difference,
        created_at=sidecar.created_at if sidecar else None,
    )


def _discard_candidate(candidate: Path) -> None:
    """Send a settled candidate and its record to the Recycle Bin."""
    for path in (candidate, candidate_sidecar_path(candidate)):
        if not path.is_file():
            continue
        try:
            delete_path(path)
        except OSError as error:
            logger.warning("Failed to discard %s: %s", path.name, error)


def accept_candidate(media: Path) -> ComfyCandidateResponse:
    """Make the candidate the real file. The file it replaces is not kept.

    Accepting is final: rejecting is what the review queue is for, and the candidate is
    only settled once the user has seen both images side by side.

    Refused when the image carries an editor backup. ``image_edit`` always renders from
    ``photo.png.bak`` and ``photo.edit.json`` claims to describe the live file, so an
    accepted candidate would leave the spec describing pixels that no longer exist and
    the next crop would render the ComfyUI pass away without saying so. Deleting the
    ``.bak`` instead would destroy a genuine original. Refusing is the only outcome that
    loses nothing, and reverting the edit clears it in one click.
    """
    candidate = candidate_path_for(media)
    if not candidate.is_file():
        raise NoCandidateError(NO_CANDIDATE_MESSAGE)

    if backup_path_for(media).is_file():
        raise ValueError(EDITED_MESSAGE)

    with settle_slot(media):
        sweep_comfy_temp_files(media.parent)

        temp_path = temp_path_for(media)
        try:
            shutil.copy2(candidate, temp_path)
            publish_replacing(temp_path, media, stale_path_for(media))
        finally:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)

        _discard_candidate(candidate)

    return _describe(media, accepted=True)


def reject_candidate(media: Path) -> ComfyCandidateResponse:
    """Discard the candidate. The dataset file is never opened."""
    candidate = candidate_path_for(media)
    if not candidate.is_file():
        raise NoCandidateError(NO_CANDIDATE_MESSAGE)

    with settle_slot(media):
        _discard_candidate(candidate)

    return _describe(media, accepted=False)
