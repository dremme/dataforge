"""Strip embedded metadata from PNG images and MP4 videos in a folder."""

from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

STRIP_PNG_SUFFIX = ".png"
STRIP_VIDEO_SUFFIX = ".mp4"
STRIP_METADATA_EXTENSIONS = {STRIP_PNG_SUFFIX, STRIP_VIDEO_SUFFIX}


def list_strip_metadata_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, STRIP_METADATA_EXTENSIONS, order="mtime")


def validate_strip_metadata_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_strip_metadata_files(folder):
        raise ValueError("No PNG or MP4 files found in folder")


def _ffmpeg_path() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)

    return None


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


def strip_mp4_metadata(path: Path, *, ffmpeg: str | None = None) -> None:
    """Remove MP4 metadata (comments, titles, etc.) without re-encoding video streams."""
    executable = ffmpeg or _ffmpeg_path()
    if not executable:
        raise RuntimeError("ffmpeg is required to strip MP4 metadata")

    temp_path = path.with_name(f"{path.stem}.strip-meta{path.suffix}")
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
        raise RuntimeError(stderr or "ffmpeg failed to strip MP4 metadata")

    temp_path.replace(path)


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
    resolved_ffmpeg = ffmpeg or _ffmpeg_path()

    def process(media_path: Path) -> FileOutcome:
        try:
            if media_path.suffix.lower() == STRIP_PNG_SUFFIX:
                strip_png_metadata(media_path)
                return FileOutcome(status="success", stats={"success": 1, "png_success": 1})

            strip_mp4_metadata(media_path, ffmpeg=resolved_ffmpeg)
            return FileOutcome(status="success", stats={"success": 1, "mp4_success": 1})
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
            "png_success": 0,
            "mp4_success": 0,
            "read_error": 0,
            "write_error": 0,
            "ffmpeg_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "read_error", "write_error", "ffmpeg_error"),
    )


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Strip metadata from PNG and MP4 files in a folder.",
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder containing PNG and/or MP4 files",
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
            "png_success",
            "mp4_success",
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
