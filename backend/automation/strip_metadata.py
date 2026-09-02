"""Strip embedded metadata from the image and ISOBMFF video files in a folder."""

from __future__ import annotations

import argparse
import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import IMAGE_EXTENSIONS, ISOBMFF_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from image_io import JPEG_SUFFIXES
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

STRIP_PNG_SUFFIX = ".png"
STRIP_WEBP_SUFFIX = ".webp"
# BMP has no metadata container: it is listed so the job does not skip the file in silence.
STRIP_BMP_SUFFIX = ".bmp"
STRIP_IMAGE_EXTENSIONS = IMAGE_EXTENSIONS
STRIP_VIDEO_EXTENSIONS = ISOBMFF_EXTENSIONS
STRIP_METADATA_EXTENSIONS = STRIP_IMAGE_EXTENSIONS | STRIP_VIDEO_EXTENSIONS

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


def strip_png_metadata(path: Path) -> None:
    """Rewrite a PNG using only its pixel data, removing all ancillary chunks."""
    with Image.open(path) as image:
        image.load()
        clean = Image.frombytes(image.mode, image.size, image.tobytes())
        if image.mode == "P":
            palette = image.getpalette()
            if palette is not None:
                clean.putpalette(palette)
        clean.save(path, format="PNG")


def strip_jpeg_segments(data: bytes) -> bytes:
    """Drop the APPn and COM segments. A Pillow round-trip would re-encode the scan instead."""
    if not data.startswith(JPEG_SOI):
        raise UnidentifiedImageError("Not a JPEG file")

    kept = [JPEG_SOI]
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
            kept.append(data[index : index + 2])
            index += 2
            continue

        if marker == _JPEG_SOS:
            # Entropy-coded data has no length; copying the tail verbatim is what keeps this lossless.
            kept.append(data[index:])
            return b"".join(kept)

        length = int.from_bytes(data[index + 2 : index + 4], "big")
        end = index + 2 + length
        if length < 2 or end > len(data):
            raise UnidentifiedImageError("Truncated JPEG segment")

        if marker not in _JPEG_DROPPED or marker in _JPEG_KEPT_APP:
            kept.append(data[index:end])
        index = end

    raise UnidentifiedImageError("JPEG ended before the image scan")


def strip_jpeg_metadata(path: Path) -> None:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise UnidentifiedImageError(str(exc)) from exc
    _replace_with_bytes(path, strip_jpeg_segments(data))


def strip_webp_chunks(data: bytes) -> bytes:
    """Drop the EXIF and XMP RIFF chunks. Re-saving through Pillow would re-compress the image."""
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
            payload = payload[:8] + bytes([flags]) + payload[9:]
        kept.append(payload)
        index = end

    if index != len(data):
        raise UnidentifiedImageError("Truncated WebP chunk")

    body = b"".join(kept)
    return _RIFF_SIGNATURE + (len(body) + 4).to_bytes(4, "little") + _WEBP_SIGNATURE + body


def strip_webp_metadata(path: Path) -> None:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise UnidentifiedImageError(str(exc)) from exc
    _replace_with_bytes(path, strip_webp_chunks(data))


def strip_isobmff_metadata(path: Path, *, ffmpeg: str | None = None) -> None:
    """Remove MP4/MOV/M4V metadata (comments, titles, etc.) without re-encoding any stream."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError("ffmpeg is required to strip video metadata")

    temp_path = path.with_name(f"{path.stem}{STRIP_TEMP_MARKER}{path.suffix}")
    command = [
        executable,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
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
        "-movflags",
        "use_metadata_tags",
        # Without this the muxer stamps its own `encoder` tag on the way out, so a stripped
        # file still names the software that wrote it.
        "-fflags",
        "+bitexact",
        str(temp_path),
    ]

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to run ffmpeg: {exc}") from exc

    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise RuntimeError(stderr or "ffmpeg failed to strip video metadata")

    temp_path.replace(path)


def strip_file_metadata(path: Path, *, ffmpeg: str | None = None) -> str:
    """Strip one file in place and return whether it was an ``image`` or a ``video``."""
    suffix = path.suffix.lower()

    if suffix in STRIP_VIDEO_EXTENSIONS:
        strip_isobmff_metadata(path, ffmpeg=ffmpeg)
        return "video"

    if suffix in JPEG_SUFFIXES:
        strip_jpeg_metadata(path)
    elif suffix == STRIP_WEBP_SUFFIX:
        strip_webp_metadata(path)
    elif suffix == STRIP_PNG_SUFFIX:
        strip_png_metadata(path)
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
            kind = strip_file_metadata(media_path, ffmpeg=resolved_ffmpeg)
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except UnidentifiedImageError as exc:
            return FileOutcome(
                status="read_error",
                stats={"read_error": 1},
                fields={"message": str(exc)},
            )
        except RuntimeError as exc:
            message = str(exc)
            status = "ffmpeg_error" if "ffmpeg" in message.lower() else "write_error"
            return FileOutcome(status=status, stats={status: 1}, fields={"message": message})
        except OSError as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

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


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Strip metadata from the image and MP4-family files in a folder.",
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder containing image and/or MP4-family files",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_strip_metadata_job(folder)
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=(
            "success",
            "image_success",
            "video_success",
            "read_error",
            "write_error",
            "ffmpeg_error",
        ),
    )
    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("ffmpeg_error") or 0) > 0:
        return 1
    if isinstance(stats, dict) and int(stats.get("write_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
