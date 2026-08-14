"""Pixel dimensions for a media file, read from its header rather than its content.

The gallery reports megapixels per item and sorts by them, so a listing needs
width and height for every file it returns - hundreds per folder, on the path
every navigation waits for. Both probes therefore stop at the header: Pillow
reads an image header without decoding it, and an MP4-family video is walked box
by box to its track header, seeking over the sample data rather than reading it.
The result is memoized against the file's stat signature, so re-listing an
unchanged folder costs no file access at all.

A container outside that family - matroska, avi, asf, flv - has no size here at
all. Reading one would mean a parser per format or an ffprobe subprocess per file
on the listing path, and the gallery already renders a missing size as an empty
megapixel cell, which is the same thing it shows for a file it cannot read.
"""

from __future__ import annotations

import logging
import struct
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

from PIL import Image, UnidentifiedImageError

from caption_cache import cached_by_stat
from constants import ISOBMFF_EXTENSIONS

__all__ = ["media_dimensions"]

logger = logging.getLogger(__name__)

_NAMESPACE = "media-dimensions"

#: A `moov` box past this is not a header any more, and is not worth the read.
_MAX_MOOV_BYTES = 8 << 20

type Dimensions = tuple[int, int] | None


def _checked(width: int, height: int) -> Dimensions:
    return (width, height) if width > 0 and height > 0 else None


def _image_dimensions(path: Path) -> Dimensions:
    try:
        with Image.open(path) as image:
            return _checked(*image.size)
    except (OSError, UnidentifiedImageError, ValueError):
        logger.debug("No image dimensions for %s", path, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# ISOBMFF (.mp4, .mov, .m4v) boxes
#
# Only enough of the container to reach `moov/trak/tkhd`. Sizes come in three
# forms - a 32-bit size, 1 for a 64-bit size that follows the type, and 0 for
# "runs to the end" - and getting any of them wrong walks into the middle of a
# box, so each is handled rather than assumed away.
# ---------------------------------------------------------------------------


def _read_moov(handle: BinaryIO, file_size: int) -> bytes | None:
    """The `moov` box, seeking over every box before it.

    Encoders put `moov` either in front of the sample data or behind it, and the
    file is only ever read where a box header actually sits, so a trailing `moov`
    costs the same handful of seeks as a leading one.
    """
    position = 0

    while position + 8 <= file_size:
        handle.seek(position)
        header = handle.read(8)
        if len(header) < 8:
            return None

        size = struct.unpack(">I", header[:4])[0]
        box_type = header[4:8]
        payload = position + 8

        if size == 1:
            extended = handle.read(8)
            if len(extended) < 8:
                return None
            size = struct.unpack(">Q", extended)[0]
            payload = position + 16
        elif size == 0:
            size = file_size - position

        if size < 8 or position + size > file_size:
            return None

        if box_type == b"moov":
            if position + size - payload > _MAX_MOOV_BYTES:
                return None
            handle.seek(payload)
            return handle.read(position + size - payload)

        position += size

    return None


def _iter_boxes(data: bytes, start: int, end: int) -> Iterator[tuple[bytes, int, int]]:
    position = start

    while position + 8 <= end:
        size = struct.unpack(">I", data[position : position + 4])[0]
        box_type = data[position + 4 : position + 8]
        payload = position + 8

        if size == 1:
            if position + 16 > end:
                return
            size = struct.unpack(">Q", data[position + 8 : position + 16])[0]
            payload = position + 16
        elif size == 0:
            size = end - position

        if size < 8 or position + size > end:
            return

        yield box_type, payload, position + size
        position += size


def _find_box(data: bytes, start: int, end: int, box_type: bytes) -> tuple[int, int] | None:
    for kind, payload, box_end in _iter_boxes(data, start, end):
        if kind == box_type:
            return payload, box_end
    return None


def _track_dimensions(data: bytes, start: int, end: int) -> Dimensions:
    """A `tkhd` box's display size, which is 16.16 fixed point."""
    version = data[start]
    # Version 1 widens the creation, modification, and duration fields to 64 bits.
    offset = start + 4 + (32 if version == 1 else 20) + 52
    if offset + 8 > end:
        return None

    width = struct.unpack(">I", data[offset : offset + 4])[0] >> 16
    height = struct.unpack(">I", data[offset + 4 : offset + 8])[0] >> 16
    return _checked(width, height)


def _video_dimensions(path: Path) -> Dimensions:
    if path.suffix.lower() not in ISOBMFF_EXTENSIONS:
        return None

    try:
        with path.open("rb") as handle:
            moov = _read_moov(handle, path.stat().st_size)
    except OSError:
        logger.debug("No video dimensions for %s", path, exc_info=True)
        return None

    if moov is None:
        logger.debug("No video dimensions for %s: no moov box", path)
        return None

    # The largest track rather than the first: a sound track carries a 0x0 header,
    # and a file with several picture tracks is showing the biggest one.
    largest: Dimensions = None
    for kind, payload, box_end in _iter_boxes(moov, 0, len(moov)):
        if kind != b"trak":
            continue

        header = _find_box(moov, payload, box_end, b"tkhd")
        if header is None:
            continue

        track = _track_dimensions(moov, *header)
        if track is not None and (largest is None or track[0] * track[1] > largest[0] * largest[1]):
            largest = track

    return largest


def media_dimensions(path: Path, media_type: str, mtime_ns: int, size: int) -> Dimensions:
    """``(width, height)`` for ``path``, or ``None`` when they cannot be read.

    ``None`` covers a file that is unreadable, malformed, or of a type that has no
    pixel dimensions at all, because the gallery treats all three the same way: it
    leaves the megapixel column of that row empty.
    """
    if media_type == "video":
        probe = _video_dimensions
    elif media_type in {"image", "gif"}:
        probe = _image_dimensions
    else:
        return None

    return cached_by_stat(_NAMESPACE, path, mtime_ns, size, lambda: probe(path))
