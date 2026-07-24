"""Strip embedded metadata from PNG images and MP4 videos in a folder."""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

STRIP_PNG_SUFFIX = ".png"
STRIP_VIDEO_SUFFIX = ".mp4"


def list_strip_metadata_files(folder: Path) -> list[Path]:
    files: list[Path] = []
    try:
        # Sort by date modified so the original order is kept
        entries = sorted(
            folder.iterdir(),
            key=lambda path: (os.path.getmtime(path), path.name.lower()),
        )
    except OSError:
        return []

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        suffix = entry.suffix.lower()
        if suffix not in {STRIP_PNG_SUFFIX, STRIP_VIDEO_SUFFIX}:
            continue

        files.append(entry)

    return files


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
    from automation.selection import filter_media_list

    validate_strip_metadata_folder(folder)

    media_files = filter_media_list(list_strip_metadata_files(folder), selected_paths)
    stats: dict[str, int] = {
        "total": len(media_files),
        "success": 0,
        "png_success": 0,
        "mp4_success": 0,
        "read_error": 0,
        "write_error": 0,
        "ffmpeg_error": 0,
        "cancelled": 0,
    }
    file_results: list[dict[str, object]] = []
    total = len(media_files)
    resolved_ffmpeg = ffmpeg or _ffmpeg_path()

    for index, media_path in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            break

        if on_progress:
            on_progress(str(media_path), media_path.name, index - 1, total, dict(stats))

        result: dict[str, object] = {
            "path": str(media_path),
            "name": media_path.name,
            "status": "success",
        }

        try:
            if media_path.suffix.lower() == STRIP_PNG_SUFFIX:
                strip_png_metadata(media_path)
                stats["success"] += 1
                stats["png_success"] += 1
            else:
                strip_mp4_metadata(media_path, ffmpeg=resolved_ffmpeg)
                stats["success"] += 1
                stats["mp4_success"] += 1
        except UnidentifiedImageError as exc:
            stats["read_error"] += 1
            result["status"] = "read_error"
            result["message"] = str(exc)
        except RuntimeError as exc:
            message = str(exc)
            if "ffmpeg" in message.lower():
                stats["ffmpeg_error"] += 1
                result["status"] = "ffmpeg_error"
            else:
                stats["write_error"] += 1
                result["status"] = "write_error"
            result["message"] = message
        except OSError as exc:
            stats["write_error"] += 1
            result["status"] = "write_error"
            result["message"] = str(exc)

        file_results.append(result)

        if on_progress:
            on_progress(str(media_path), media_path.name, index, total, dict(stats))

    processed = sum(
        stats[key]
        for key in (
            "success",
            "read_error",
            "write_error",
            "ffmpeg_error",
        )
    )

    return {
        "folder": str(folder),
        "total": stats["total"],
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }


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
