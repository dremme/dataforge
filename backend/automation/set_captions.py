"""Utility job to set a fixed caption text on images and videos (creates .txt sidecars or updates existing .json captions)."""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from pathlib import Path

from captions import media_has_caption_text, save_caption
from constants import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def list_set_captions_media(folder: Path) -> list[Path]:
    media: list[Path] = []
    try:
        entries = sorted(folder.iterdir(), key=lambda path: path.name.lower())
    except OSError:
        return []

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.suffix.lower() in MEDIA_EXTENSIONS:
            media.append(entry)

    return media


def validate_set_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_set_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")


def run_set_captions_job(
    folder: Path,
    caption_text: str,
    *,
    overwrite: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    from automation.selection import filter_media_list

    validate_set_captions_folder(folder)

    media_files = filter_media_list(list_set_captions_media(folder), selected_paths)
    stats: dict[str, int] = {
        "total": len(media_files),
        "success": 0,
        "skipped": 0,
        "write_error": 0,
        "cancelled": 0,
    }
    file_results: list[dict[str, object]] = []
    total = len(media_files)
    text = (caption_text or "").strip()

    for index, media_path in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            break

        if on_progress:
            on_progress(str(media_path), media_path.name, index - 1, total, dict(stats))

        has_existing = False
        try:
            has_existing = media_has_caption_text(media_path)
        except Exception:
            # Treat read issues as no caption; write attempt will surface error if any
            has_existing = False

        if has_existing and not overwrite:
            stats["skipped"] += 1
            file_results.append(
                {
                    "path": str(media_path),
                    "name": media_path.name,
                    "status": "skipped",
                    "message": "Existing caption present",
                }
            )
            if on_progress:
                on_progress(str(media_path), media_path.name, index, total, dict(stats))
            continue

        result: dict[str, object] = {
            "path": str(media_path),
            "name": media_path.name,
            "status": "success",
            "description": text or None,
        }

        try:
            save_caption(media_path, text)
            stats["success"] += 1
        except Exception as exc:
            stats["write_error"] += 1
            result["status"] = "write_error"
            result["message"] = str(exc)
            result.pop("description", None)

        file_results.append(result)

        if on_progress:
            on_progress(str(media_path), media_path.name, index, total, dict(stats))

    processed = (
        int(stats.get("success") or 0)
        + int(stats.get("skipped") or 0)
        + int(stats.get("write_error") or 0)
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
        description="Set the same caption text for all images and videos in a folder.",
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder containing images and/or videos",
    )
    parser.add_argument(
        "--caption",
        required=True,
        help="Caption text to write to sidecars",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing captions instead of skipping files that already have them",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_set_captions_job(
            folder,
            args.caption,
            overwrite=args.overwrite,
        )
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=("success", "skipped", "write_error", "cancelled"),
    )
    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("write_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
