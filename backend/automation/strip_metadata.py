"""Strip embedded metadata from the image and ISOBMFF video files in a folder."""

from __future__ import annotations

import zlib
from collections.abc import Callable, Iterator
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image, UnidentifiedImageError

from automation.job_runner import FileOutcome, ProgressCallback, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import IMAGE_EXTENSIONS, ISOBMFF_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, ShouldCancel, run_ffmpeg
from image_io import JPEG_SUFFIXES

# BMP has no metadata container: it is listed so the job does not skip the file in silence.
STRIP_BMP_SUFFIX = ".bmp"
STRIP_METADATA_EXTENSIONS = IMAGE_EXTENSIONS | ISOBMFF_EXTENSIONS

# Sits before the suffix so the watermark job's `*.watermark-tmp.*` sweep still reaches it.
STRIP_TEMP_MARKER = ".strip-meta"

JPEG_SOI = b"\xff\xd8"
_JPEG_SOS = 0xDA
# TEM and the restart markers carry no length field, so they are copied as the bare two bytes.
_JPEG_STANDALONE = frozenset({0x01, *range(0xD0, 0xD8)})
# APPn plus COM. Everything here identifies the source rather than describing the scan.
_JPEG_DROPPED = frozenset({*range(0xE0, 0xF0), 0xFE})
# Kept out of the drop set: JFIF carries pixel density, ICC the colour space and Adobe the
# component transform, so dropping them would change how the image renders, not just its origin.
_JPEG_KEPT_APP = frozenset({0xE0, 0xE2, 0xEE})

_RIFF_SIGNATURE = b"RIFF"
_WEBP_SIGNATURE = b"WEBP"
_WEBP_METADATA_CHUNKS = frozenset({b"EXIF", b"XMP "})
_WEBP_VP8X_CHUNK = b"VP8X"
# Feature flags in the first payload byte of VP8X; ICC (0x20) is kept for the reason above.
_WEBP_VP8X_METADATA_FLAGS = 0x08 | 0x04

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_IHDR = b"IHDR"
_PNG_IEND = b"IEND"
# Text, EXIF and modification time identify the source; iCCP/gAMA/cHRM/sRGB/pHYs/tRNS and the
# animation chunks all change how the image renders, so only the provenance chunks are dropped.
PNG_PROVENANCE_CHUNKS = frozenset({b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"})


#: What prefixes the TIFF block in a JPEG APP1 segment; PNG eXIf and WebP EXIF carry it bare.
EXIF_HEADER = b"Exif\x00\x00"
_JPEG_APP0 = 0xE0
_JPEG_APP1 = 0xE1
_WEBP_VP8X_EXIF_FLAG = 0x08
_ORIENTATION_TAG = 0x0112


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return len(data).to_bytes(4, "big") + chunk_type + data + crc.to_bytes(4, "big")


def orientation_of(data: bytes) -> int:
    """The EXIF Orientation an image displays with; 1 when it has none or it cannot be read."""
    try:
        with Image.open(BytesIO(data)) as image:
            value = image.getexif().get(_ORIENTATION_TAG, 1)
    except (OSError, ValueError, SyntaxError):
        return 1
    return value if isinstance(value, int) and 1 <= value <= 8 else 1


def orientation_exif(orientation: int) -> bytes:
    """A bare TIFF block holding only Orientation: what stripping keeps so the pixels still turn."""
    exif = Image.Exif()
    exif[_ORIENTATION_TAG] = orientation
    return exif.tobytes().removeprefix(EXIF_HEADER)


def upright_exif(tiff: bytes) -> bytes:
    """``tiff`` with its Orientation set to 1, patched in place so no other tag is re-encoded.

    For metadata moved onto pixels that are already upright, such as a ComfyUI result.
    """
    endian: Literal["little", "big"]
    if tiff[:2] == b"II":
        endian = "little"
    elif tiff[:2] == b"MM":
        endian = "big"
    else:
        return tiff
    if len(tiff) < 8:
        return tiff
    ifd = int.from_bytes(tiff[4:8], endian)
    if ifd + 2 > len(tiff):
        return tiff
    for index in range(int.from_bytes(tiff[ifd : ifd + 2], endian)):
        entry = ifd + 2 + 12 * index
        if entry + 12 > len(tiff):
            break
        if int.from_bytes(tiff[entry : entry + 2], endian) == _ORIENTATION_TAG:
            # A SHORT sits left-justified in the entry's 4-byte value field.
            value = entry + 8
            return tiff[:value] + (1).to_bytes(2, endian) + tiff[value + 2 :]
    return tiff


def list_strip_metadata_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, STRIP_METADATA_EXTENSIONS, order="mtime")


def validate_strip_metadata_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_strip_metadata_files(folder):
        raise ValueError("No JPG, PNG, WebP, BMP, MP4, MOV or M4V files found in folder")


def _replace_with_bytes(path: Path, data: bytes) -> None:
    """Publish rewritten container bytes so a failed write leaves the original in place."""
    temp_path = path.with_name(f"{path.stem}{STRIP_TEMP_MARKER}{path.suffix}")
    try:
        temp_path.write_bytes(data)
        temp_path.replace(path)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise


def iter_png_chunks(data: bytes) -> Iterator[tuple[bytes, bytes]]:
    """Yield ``(type, whole chunk)`` up to and including IEND; whole chunks keep their CRC valid."""
    if not data.startswith(PNG_SIGNATURE):
        raise UnidentifiedImageError("Not a PNG file")

    index = len(PNG_SIGNATURE)
    while index + 8 <= len(data):
        length = int.from_bytes(data[index : index + 4], "big")
        chunk_type = data[index + 4 : index + 8]
        # Length, type, payload and the 4-byte CRC.
        end = index + 12 + length
        if end > len(data):
            raise UnidentifiedImageError("Truncated PNG chunk")

        yield chunk_type, data[index:end]
        index = end

        if chunk_type == _PNG_IEND:
            return

    raise UnidentifiedImageError("PNG ended before the IEND chunk")


def strip_png_chunks(data: bytes, *, orientation: int = 1) -> bytes:
    """Drop the text, EXIF and time chunks; a Pillow re-save would lose iCCP/gAMA and APNG frames.

    An ``orientation`` other than 1 is written back as an Orientation-only ``eXIf``.
    """
    kept: list[bytes] = []
    for chunk_type, chunk in iter_png_chunks(data):
        if chunk_type in PNG_PROVENANCE_CHUNKS:
            continue
        kept.append(chunk)
        if chunk_type == _PNG_IHDR and orientation != 1:
            kept.append(png_chunk(b"eXIf", orientation_exif(orientation)))
    return PNG_SIGNATURE + b"".join(kept)


def strip_jpeg_segments(data: bytes, *, orientation: int = 1) -> bytes:
    """Drop the APPn and COM segments. A Pillow round-trip would re-encode the scan instead.

    An ``orientation`` other than 1 is written back as an Orientation-only APP1, after any JFIF.
    """
    if not data.startswith(JPEG_SOI):
        raise UnidentifiedImageError("Not a JPEG file")

    kept = [JPEG_SOI]
    pending: bytes | None = None
    if orientation != 1:
        payload = EXIF_HEADER + orientation_exif(orientation)
        pending = bytes([0xFF, _JPEG_APP1]) + (len(payload) + 2).to_bytes(2, "big") + payload

    def flush_pending() -> None:
        nonlocal pending
        if pending is not None:
            kept.append(pending)
            pending = None

    index = 2
    while index + 1 < len(data):
        if data[index] != 0xFF:
            raise UnidentifiedImageError("Malformed JPEG segment")

        marker = data[index + 1]
        # Any number of 0xFF bytes may pad the gap before a marker.
        if marker == 0xFF:
            index += 1
            continue

        if marker in _JPEG_STANDALONE:
            flush_pending()
            kept.append(data[index : index + 2])
            index += 2
            continue

        if marker == _JPEG_SOS:
            flush_pending()
            # Entropy-coded data has no length; copying the tail verbatim is what keeps this lossless.
            kept.append(data[index:])
            return b"".join(kept)

        length = int.from_bytes(data[index + 2 : index + 4], "big")
        end = index + 2 + length
        if length < 2 or end > len(data):
            raise UnidentifiedImageError("Truncated JPEG segment")

        if marker not in _JPEG_DROPPED or marker in _JPEG_KEPT_APP:
            if marker != _JPEG_APP0:
                flush_pending()
            kept.append(data[index:end])
        index = end

    raise UnidentifiedImageError("JPEG ended before the image scan")


def strip_webp_chunks(data: bytes, *, orientation: int = 1) -> bytes:
    """Drop the EXIF and XMP RIFF chunks. Re-saving through Pillow would re-compress the image.

    An ``orientation`` other than 1 is written back as an Orientation-only EXIF chunk. Only an
    extended (VP8X) file can carry EXIF, so a simple file never had an orientation to keep.
    """
    if len(data) < 12 or data[:4] != _RIFF_SIGNATURE or data[8:12] != _WEBP_SIGNATURE:
        raise UnidentifiedImageError("Not a WebP file")

    kept: list[bytes] = []
    index = 12
    while index + 8 <= len(data):
        chunk_type = data[index : index + 4]
        size = int.from_bytes(data[index + 4 : index + 8], "little")
        # Chunks pad to an even length and the pad byte is not counted in the size field.
        end = index + 8 + size + (size & 1)
        if end > len(data):
            raise UnidentifiedImageError("Truncated WebP chunk")

        if chunk_type in _WEBP_METADATA_CHUNKS:
            index = end
            continue

        payload = data[index:end]
        if chunk_type == _WEBP_VP8X_CHUNK and size >= 1:
            # The flags must agree with the chunks that remain or decoders look for a missing EXIF.
            flags = data[index + 8] & ~_WEBP_VP8X_METADATA_FLAGS
            if orientation != 1:
                flags |= _WEBP_VP8X_EXIF_FLAG
            payload = payload[:8] + bytes([flags]) + payload[9:]
        kept.append(payload)
        index = end

    if index != len(data):
        raise UnidentifiedImageError("Truncated WebP chunk")

    if orientation != 1 and kept and kept[0][:4] == _WEBP_VP8X_CHUNK:
        # EXIF goes after the image data, where the stripped chunk sat.
        exif = orientation_exif(orientation)
        padding = b"\x00" * (len(exif) & 1)
        kept.append(b"EXIF" + len(exif).to_bytes(4, "little") + exif + padding)

    body = b"".join(kept)
    return _RIFF_SIGNATURE + (len(body) + 4).to_bytes(4, "little") + _WEBP_SIGNATURE + body


_IMAGE_STRIPPERS: dict[str, Callable[..., bytes]] = {
    **dict.fromkeys(JPEG_SUFFIXES, strip_jpeg_segments),
    ".png": strip_png_chunks,
    ".webp": strip_webp_chunks,
}


def _strip_image_bytes(path: Path, strip: Callable[..., bytes]) -> None:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise UnidentifiedImageError(str(exc)) from exc
    _replace_with_bytes(path, strip(data, orientation=orientation_of(data)))


def strip_isobmff_metadata(
    path: Path, *, ffmpeg: str | None = None, should_cancel: ShouldCancel | None = None
) -> None:
    """Remove MP4/MOV/M4V metadata (comments, titles, etc.) without re-encoding any stream."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError("ffmpeg is required to strip video metadata")

    temp_path = path.with_name(f"{path.stem}{STRIP_TEMP_MARKER}{path.suffix}")
    command = [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(path),
        "-map",
        "0",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-c",
        "copy",
        # Without this the muxer stamps its own `encoder` tag on the way out, so a stripped
        # file still names the software that wrote it.
        "-fflags",
        "+bitexact",
        # A plain, front-loaded container: a stripped copy is still a standard streamable MP4.
        "-movflags",
        "+faststart",
        str(temp_path),
    ]

    try:
        run_ffmpeg(command, should_cancel=should_cancel)
    except (RuntimeError, FfmpegCancelled):
        temp_path.unlink(missing_ok=True)
        raise

    temp_path.replace(path)


def strip_file_metadata(
    path: Path, *, ffmpeg: str | None = None, should_cancel: ShouldCancel | None = None
) -> str:
    """Strip one file in place and return whether it was an ``image`` or a ``video``."""
    suffix = path.suffix.lower()

    if suffix in ISOBMFF_EXTENSIONS:
        strip_isobmff_metadata(path, ffmpeg=ffmpeg, should_cancel=should_cancel)
        return "video"

    strip = _IMAGE_STRIPPERS.get(suffix)
    if strip is not None:
        _strip_image_bytes(path, strip)
    elif suffix != STRIP_BMP_SUFFIX:
        raise UnidentifiedImageError(f"Cannot strip metadata from {suffix} files")

    # BMP falls through untouched: the format has no container for metadata to hide in.
    return "image"


def run_strip_metadata_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_strip_metadata_folder(folder)

    media_files = filter_media_list(list_strip_metadata_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    def process(media_path: Path) -> FileOutcome:
        try:
            kind = strip_file_metadata(
                media_path, ffmpeg=resolved_ffmpeg, should_cancel=should_cancel
            )
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except FfmpegCancelled:
            return FileOutcome.cancelled()
        except UnidentifiedImageError as exc:
            return FileOutcome.counted("read_error", exc)
        except RuntimeError as exc:
            status = "ffmpeg_error" if "ffmpeg" in str(exc).lower() else "write_error"
            return FileOutcome.counted(status, exc)
        except OSError as exc:
            return FileOutcome.counted("write_error", exc)

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "image_success": 0,
            "video_success": 0,
            "read_error": 0,
            "write_error": 0,
            "ffmpeg_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        # image_success and video_success are sub-stats of success and must not be counted.
        processed_stat_keys=("success", "read_error", "write_error", "ffmpeg_error"),
    )
