"""Carry a source file's provenance metadata onto the ComfyUI candidate that replaces it."""

from __future__ import annotations

import shutil
import zlib
from pathlib import Path

from PIL import Image

from automation.strip_metadata import (
    PNG_PROVENANCE_CHUNKS,
    PNG_SIGNATURE,
    iter_png_chunks,
    strip_png_chunks,
)
from constants import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import run_ffmpeg

_PNG_IHDR = b"IHDR"
_EXIF_HEADER = b"Exif\x00\x00"
_XMP_KEYWORD = b"XML:com.adobe.xmp"
_COMMENT_KEYWORD = b"Comment"
# The temp file's own suffix names no container, so the muxer is chosen explicitly.
_ISOBMFF_MUXERS = {".mp4": "mp4", ".mov": "mov"}


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return len(data).to_bytes(4, "big") + chunk_type + data + crc.to_bytes(4, "big")


def _itxt_chunk(keyword: bytes, text: bytes) -> bytes:
    # Uncompressed, with empty language tag and translated keyword.
    return _png_chunk(b"iTXt", keyword + b"\x00\x00\x00\x00\x00" + text)


def _source_png_chunks(source: Path) -> list[bytes]:
    """The source's metadata as PNG chunks: copied verbatim from a PNG, translated otherwise."""
    if source.suffix.lower() == ".png":
        return [
            chunk
            for chunk_type, chunk in iter_png_chunks(source.read_bytes())
            if chunk_type in PNG_PROVENANCE_CHUNKS
        ]

    with Image.open(source) as image:
        info = dict(image.info)

    chunks: list[bytes] = []
    exif = info.get("exif")
    if isinstance(exif, bytes) and exif:
        chunks.append(_png_chunk(b"eXIf", exif.removeprefix(_EXIF_HEADER)))
    xmp = info.get("xmp")
    if isinstance(xmp, bytes) and xmp:
        chunks.append(_itxt_chunk(_XMP_KEYWORD, xmp))
    comment = info.get("comment")
    if isinstance(comment, bytes) and comment:
        chunks.append(_itxt_chunk(_COMMENT_KEYWORD, comment))
    return chunks


def _png_with_source_metadata(source: Path, candidate: Path) -> bytes:
    """Candidate pixels and rendering chunks, with the source's metadata right after IHDR."""
    stripped = strip_png_chunks(candidate.read_bytes())
    transplanted = _source_png_chunks(source)

    parts = [PNG_SIGNATURE]
    for chunk_type, chunk in iter_png_chunks(stripped):
        parts.append(chunk)
        if chunk_type == _PNG_IHDR:
            parts.extend(transplanted)
    return b"".join(parts)


def _remux_with_source_metadata(
    source: Path, candidate: Path, destination: Path, *, ffmpeg: str | None
) -> None:
    """Copy every candidate stream untouched; only the global tags come from the source."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError("ffmpeg is required to keep a video's metadata")

    command = [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(candidate),
        "-i",
        str(source),
        "-map",
        "0",
        "-map_metadata",
        "1",
        "-map_chapters",
        "-1",
        "-c",
        "copy",
        # Without use_metadata_tags the muxer drops keys outside its fixed list, such as the
        # `prompt` and `workflow` tags a ComfyUI-made source carries.
        "-movflags",
        "+faststart+use_metadata_tags",
        "-f",
        _ISOBMFF_MUXERS[candidate.suffix.lower()],
        str(destination),
    ]
    run_ffmpeg(command)


def write_with_source_metadata(
    source: Path, candidate: Path, destination: Path, *, ffmpeg: str | None = None
) -> None:
    """Write ``candidate`` to ``destination`` with ``source``'s metadata in place of its own.

    The candidate's provenance metadata is replaced, not merged; what describes its pixels (ICC
    profile, gamma, stream rotation) stays. A PNG candidate takes an image source's metadata, an
    MP4/MOV candidate a video source's. Any other pairing, such as a GIF candidate or a still
    turned into a clip, has nowhere to carry the metadata, so the candidate is copied unchanged.

    Raises ``ValueError`` when the metadata cannot be read or written.
    """
    candidate_suffix = candidate.suffix.lower()
    source_suffix = source.suffix.lower()

    still = candidate_suffix == ".png" and source_suffix in IMAGE_EXTENSIONS
    clip = candidate_suffix in _ISOBMFF_MUXERS and source_suffix in VIDEO_EXTENSIONS
    if not (still or clip):
        shutil.copy2(candidate, destination)
        return

    try:
        if still:
            destination.write_bytes(_png_with_source_metadata(source, candidate))
        else:
            _remux_with_source_metadata(source, candidate, destination, ffmpeg=ffmpeg)
    # UnidentifiedImageError is an OSError, so an unreadable source lands here too.
    except (OSError, RuntimeError) as error:
        raise ValueError(
            f"Could not keep the original metadata of {source.name}: {error}. "
            "Untick Keep original metadata to accept without it."
        ) from error
