"""Pixel size and video length from a media file header, not its sample data.

The gallery reports megapixels and (for video) duration per item, so a listing
needs those facts for every file it returns - hundreds per folder, on the path
every navigation waits for. Both probes therefore stop at the header: Pillow
reads an image header without decoding it, an MP4-family video is walked box by
box to its track and media headers, and a matroska one element by element to its
segment info and track entries. Both containers seek over the sample data rather
than reading it. The result is memoized against the file's stat signature, so
re-listing an unchanged folder costs no file access at all.

A container outside those two - avi, asf, flv - has no size or length here at
all. Reading one would mean a parser per remaining format or an ffprobe
subprocess per file on the listing path, and the gallery already renders a
missing fact as an empty cell.
"""

from __future__ import annotations

import logging
import struct
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image, UnidentifiedImageError

from caption_cache import cached_by_stat
from constants import ISOBMFF_EXTENSIONS, MATROSKA_EXTENSIONS

__all__ = ["MediaInfo", "media_dimensions", "media_info"]

logger = logging.getLogger(__name__)

_NAMESPACE = "media-info"

#: A `moov` box past this is not a header any more, and is not worth the read.
_MAX_MOOV_BYTES = 8 << 20

#: Same bargain for a matroska `Info` or `Tracks` element: both are a handful of
#: kilobytes in every real file, so anything larger is not what we came to read.
_MAX_EBML_HEADER_BYTES = 8 << 20

type Dimensions = tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class MediaInfo:
    width: int | None = None
    height: int | None = None
    duration: float | None = None


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
# Only enough of the container to reach `moov/trak/tkhd` for size and
# `mdia/mdhd` (or `mvhd`) for length. Sizes come in three forms - a 32-bit
# size, 1 for a 64-bit size that follows the type, and 0 for "runs to the
# end" - and getting any of them wrong walks into the middle of a box, so
# each is handled rather than assumed away.
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


def _timescale_duration(data: bytes, start: int, end: int) -> float | None:
    """Seconds from an ``mdhd`` or ``mvhd`` full box, or ``None`` when unreadable."""
    if start >= end:
        return None

    wide = data[start] == 1
    offset = start + (20 if wide else 12)
    size = 12 if wide else 8
    if offset + size > end:
        return None

    timescale, duration = (
        struct.unpack(">IQ", data[offset : offset + 12])
        if wide
        else struct.unpack(">II", data[offset : offset + 8])
    )
    if timescale <= 0 or duration <= 0:
        return None
    return duration / timescale


def _track_info(data: bytes, start: int, end: int) -> tuple[Dimensions, float | None]:
    """Display size and media-header duration from one ``trak``, in a single walk."""
    dimensions: Dimensions = None
    duration: float | None = None
    for kind, payload, box_end in _iter_boxes(data, start, end):
        if kind == b"tkhd":
            dimensions = _track_dimensions(data, payload, box_end)
        elif kind == b"mdia":
            header = _find_box(data, payload, box_end, b"mdhd")
            if header is not None:
                duration = _timescale_duration(data, *header)
    return dimensions, duration


def _isobmff_info(path: Path, file_size: int) -> MediaInfo:
    try:
        with path.open("rb") as handle:
            moov = _read_moov(handle, file_size)
    except OSError:
        logger.debug("No video header for %s", path, exc_info=True)
        return MediaInfo()

    if moov is None:
        logger.debug("No video header for %s: no moov box", path)
        return MediaInfo()

    # The largest picture track rather than the first: a sound track is 0x0, and
    # a file with several picture tracks is showing the biggest one. ``mvhd`` is
    # the length fallback when the winning track has no ``mdhd``.
    largest: Dimensions = None
    track_duration: float | None = None
    movie_duration: float | None = None
    for kind, payload, box_end in _iter_boxes(moov, 0, len(moov)):
        if kind == b"mvhd":
            movie_duration = _timescale_duration(moov, payload, box_end)
        elif kind == b"trak":
            track, duration = _track_info(moov, payload, box_end)
            if track is not None and (
                largest is None or track[0] * track[1] > largest[0] * largest[1]
            ):
                largest = track
                track_duration = duration

    width, height = largest or (None, None)
    return MediaInfo(
        width=width,
        height=height,
        duration=track_duration if track_duration is not None else movie_duration,
    )


# ---------------------------------------------------------------------------
# Matroska (.mkv) EBML elements
#
# Every element is an ID, a size, and a payload, where both the ID and the size
# are variable-width integers whose first set bit says how many bytes they span.
# The ID keeps that marker bit - it is part of the identity - while the size
# strips it, and a size of all ones means "unknown", which streamed files use
# for the `Segment` and for a trailing `Cluster`.
#
# Only two of the segment's children are read: `Info` for the length and
# `Tracks` for the frame size. Everything between them - the clusters holding
# the actual frames - is seeked over, never read.
# ---------------------------------------------------------------------------

_EBML_HEADER = 0x1A45DFA3
_EBML_SEGMENT = 0x18538067
_EBML_INFO = 0x1549A966
_EBML_TIMECODE_SCALE = 0x2AD7B1
_EBML_DURATION = 0x4489
_EBML_TRACKS = 0x1654AE6B
_EBML_TRACK_ENTRY = 0xAE
_EBML_TRACK_TYPE = 0x83
_EBML_VIDEO = 0xE0
_EBML_PIXEL_WIDTH = 0xB0
_EBML_PIXEL_HEIGHT = 0xBA
_EBML_DISPLAY_WIDTH = 0x54B0
_EBML_DISPLAY_HEIGHT = 0x54BA
_EBML_DISPLAY_UNIT = 0x54B2

_VIDEO_TRACK_TYPE = 1
_DISPLAY_UNIT_PIXELS = 0

#: `TimecodeScale` defaults to a millisecond, in nanoseconds, when the file omits it.
_DEFAULT_TIMECODE_SCALE = 1_000_000

#: The longest ID plus the longest size, which is all an element header can ever be.
_MAX_EBML_HEADER_LENGTH = 16

_UNKNOWN_SIZE = -1


def _vint_length(first: int) -> int:
    """Bytes spanned by the variable-width integer starting with ``first``, or 0."""
    for length in range(1, 9):
        if first & (0x80 >> (length - 1)):
            return length
    return 0


def _read_vint_id(data: bytes, position: int, end: int) -> tuple[int, int] | None:
    """``(element id, position after it)``. The marker bit stays: it identifies."""
    if position >= end:
        return None

    length = _vint_length(data[position])
    if length == 0 or position + length > end:
        return None

    return int.from_bytes(data[position : position + length], "big"), position + length


def _read_vint_size(data: bytes, position: int, end: int) -> tuple[int, int] | None:
    """``(payload size, position after it)``, or ``_UNKNOWN_SIZE`` for all ones."""
    if position >= end:
        return None

    length = _vint_length(data[position])
    if length == 0 or position + length > end:
        return None

    capacity = (1 << (7 * length)) - 1
    value = int.from_bytes(data[position : position + length], "big") & capacity
    size = _UNKNOWN_SIZE if value == capacity else value
    return size, position + length


def _iter_ebml(data: bytes, start: int, end: int) -> Iterator[tuple[int, int, int]]:
    """``(element id, payload start, payload end)`` for each element in ``data``."""
    position = start

    while position < end:
        header = _read_vint_id(data, position, end)
        if header is None:
            return
        element_id, position = header

        sized = _read_vint_size(data, position, end)
        if sized is None:
            return
        size, position = sized

        if size == _UNKNOWN_SIZE:
            # Nothing after an element of unknown length can be found without
            # decoding it, so this one runs to the end and the walk stops here.
            yield element_id, position, end
            return

        element_end = position + size
        if element_end > end:
            return

        yield element_id, position, element_end
        position = element_end


def _ebml_uint(data: bytes, start: int, end: int) -> int | None:
    return int.from_bytes(data[start:end], "big") if 0 < end - start <= 8 else None


def _ebml_float(data: bytes, start: int, end: int) -> float | None:
    width = end - start
    if width == 4:
        return struct.unpack(">f", data[start:end])[0]
    if width == 8:
        return struct.unpack(">d", data[start:end])[0]
    return None


def _read_ebml_header(handle: BinaryIO, position: int, end: int) -> tuple[int, int, int] | None:
    """The element at ``position`` in the open file, read without its payload."""
    handle.seek(position)
    header = handle.read(_MAX_EBML_HEADER_LENGTH)
    if not header:
        return None

    identified = _read_vint_id(header, 0, len(header))
    if identified is None:
        return None
    element_id, offset = identified

    sized = _read_vint_size(header, offset, len(header))
    if sized is None:
        return None
    size, offset = sized

    payload = position + offset
    if size == _UNKNOWN_SIZE:
        return element_id, payload, end

    element_end = payload + size
    return None if element_end > end else (element_id, payload, element_end)


def _read_segment_headers(handle: BinaryIO, file_size: int) -> tuple[bytes | None, bytes | None]:
    """The segment's ``Info`` and ``Tracks`` payloads, seeking over its clusters."""
    position = 0
    segment: tuple[int, int] | None = None

    while position < file_size:
        element = _read_ebml_header(handle, position, file_size)
        if element is None:
            return None, None
        element_id, payload, element_end = element

        # A file whose first element is not the EBML header is not matroska,
        # whatever its name says, and walking on would be walking noise.
        if position == 0 and element_id != _EBML_HEADER:
            return None, None
        if element_id == _EBML_SEGMENT:
            segment = (payload, element_end)
            break
        position = element_end

    if segment is None:
        return None, None

    info: bytes | None = None
    tracks: bytes | None = None
    position, segment_end = segment

    while position < segment_end and (info is None or tracks is None):
        element = _read_ebml_header(handle, position, segment_end)
        if element is None:
            break
        element_id, payload, element_end = element

        if element_id in {_EBML_INFO, _EBML_TRACKS} and (
            element_end - payload <= _MAX_EBML_HEADER_BYTES
        ):
            handle.seek(payload)
            data = handle.read(element_end - payload)
            if element_id == _EBML_INFO:
                info = data
            else:
                tracks = data

        position = element_end

    return info, tracks


def _matroska_duration(info: bytes) -> float | None:
    """Seconds from ``Info``, whose ``Duration`` counts ``TimecodeScale`` nanoseconds."""
    scale = _DEFAULT_TIMECODE_SCALE
    ticks: float | None = None

    for element_id, start, end in _iter_ebml(info, 0, len(info)):
        if element_id == _EBML_TIMECODE_SCALE:
            value = _ebml_uint(info, start, end)
            if value:
                scale = value
        elif element_id == _EBML_DURATION:
            ticks = _ebml_float(info, start, end)

    if ticks is None or ticks <= 0:
        return None

    seconds = ticks * scale / 1_000_000_000
    return seconds if seconds > 0 else None


def _video_element_dimensions(data: bytes, start: int, end: int) -> Dimensions:
    """A track's frame size, preferring the display size the MP4 path also reports.

    ``DisplayWidth``/``DisplayHeight`` are what a player draws - the coded size with
    any anamorphic stretch already applied - which is the same fact ``tkhd`` carries
    for the MP4 family. They are only comparable when they are in pixels, though:
    the unit is free to be centimetres, inches, or a bare aspect ratio instead.
    """
    pixel_width = pixel_height = 0
    display_width = display_height = 0
    display_unit = _DISPLAY_UNIT_PIXELS

    for element_id, value_start, value_end in _iter_ebml(data, start, end):
        value = _ebml_uint(data, value_start, value_end)
        if value is None:
            continue
        if element_id == _EBML_PIXEL_WIDTH:
            pixel_width = value
        elif element_id == _EBML_PIXEL_HEIGHT:
            pixel_height = value
        elif element_id == _EBML_DISPLAY_WIDTH:
            display_width = value
        elif element_id == _EBML_DISPLAY_HEIGHT:
            display_height = value
        elif element_id == _EBML_DISPLAY_UNIT:
            display_unit = value

    if display_unit == _DISPLAY_UNIT_PIXELS and display_width > 0 and display_height > 0:
        return _checked(display_width, display_height)
    return _checked(pixel_width, pixel_height)


def _matroska_dimensions(tracks: bytes) -> Dimensions:
    """The largest picture track in ``Tracks``, for the reason the MP4 path has."""
    largest: Dimensions = None

    for element_id, start, end in _iter_ebml(tracks, 0, len(tracks)):
        if element_id != _EBML_TRACK_ENTRY:
            continue

        track_type: int | None = None
        dimensions: Dimensions = None
        for child_id, child_start, child_end in _iter_ebml(tracks, start, end):
            if child_id == _EBML_TRACK_TYPE:
                track_type = _ebml_uint(tracks, child_start, child_end)
            elif child_id == _EBML_VIDEO:
                dimensions = _video_element_dimensions(tracks, child_start, child_end)

        if track_type != _VIDEO_TRACK_TYPE or dimensions is None:
            continue
        if largest is None or dimensions[0] * dimensions[1] > largest[0] * largest[1]:
            largest = dimensions

    return largest


def _matroska_info(path: Path, file_size: int) -> MediaInfo:
    try:
        with path.open("rb") as handle:
            info, tracks = _read_segment_headers(handle, file_size)
    except OSError:
        logger.debug("No video header for %s", path, exc_info=True)
        return MediaInfo()

    if info is None and tracks is None:
        logger.debug("No video header for %s: no matroska segment", path)
        return MediaInfo()

    width, height = (None, None) if tracks is None else _matroska_dimensions(tracks) or (None, None)
    return MediaInfo(
        width=width,
        height=height,
        duration=None if info is None else _matroska_duration(info),
    )


def _video_info(path: Path, file_size: int) -> MediaInfo:
    suffix = path.suffix.lower()
    if suffix in ISOBMFF_EXTENSIONS:
        return _isobmff_info(path, file_size)
    if suffix in MATROSKA_EXTENSIONS:
        return _matroska_info(path, file_size)
    return MediaInfo()


def _image_info(path: Path) -> MediaInfo:
    width, height = _image_dimensions(path) or (None, None)
    return MediaInfo(width=width, height=height)


def media_info(path: Path, media_type: str, mtime_ns: int, size: int) -> MediaInfo:
    """Pixel size and, for an MP4-family or matroska video, length in seconds.

    Missing facts are ``None``: unreadable, malformed, or a type that has no
    header we can walk. The gallery treats those the same way - an empty cell.
    ``size`` is the listing's already-paid-for stat, so the probe never stats
    the file a second time.
    """
    if media_type == "video":
        return cached_by_stat(_NAMESPACE, path, mtime_ns, size, lambda: _video_info(path, size))
    if media_type in {"image", "gif"}:
        return cached_by_stat(_NAMESPACE, path, mtime_ns, size, lambda: _image_info(path))
    return MediaInfo()


def media_dimensions(path: Path, media_type: str, mtime_ns: int, size: int) -> Dimensions:
    """``(width, height)`` for ``path``, or ``None`` when they cannot be read.

    ``None`` covers a file that is unreadable, malformed, or of a type that has no
    pixel dimensions at all, because the gallery treats all three the same way: it
    leaves the megapixel column of that row empty.
    """
    info = media_info(path, media_type, mtime_ns, size)
    if info.width is None or info.height is None:
        return None
    return (info.width, info.height)
