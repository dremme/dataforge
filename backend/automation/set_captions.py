"""Utility job to set a fixed caption text on images and videos (creates .txt sidecars or updates existing .json captions)."""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from pathlib import Path

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from captions import media_has_caption_text, save_caption
from constants import MEDIA_EXTENSIONS
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]


def list_set_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_set_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_set_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")


def run_set_captions_job(
    folder: Path,
    *,
    caption: str,
    overwrite: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_set_captions_folder(folder)

    media_files = filter_media_list(list_set_captions_media(folder), selected_paths)
    text = (caption or "").strip()

    def process(media_path: Path) -> FileOutcome:
        try:
            has_existing = media_has_caption_text(media_path)
        except Exception:
            # Treat read issues as no caption; the write attempt surfaces any real error.
            has_existing = False

        if has_existing and not overwrite:
            return FileOutcome(
                status="skipped",
                stats={"skipped": 1},
                fields={"message": "Existing caption present"},
            )

        try:
            save_caption(media_path, text)
        except Exception as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

        return FileOutcome(
            status="success",
            stats={"success": 1},
            fields={"description": text or None},
        )

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "skipped": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "skipped", "write_error"),
    )


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
            caption=args.caption,
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
