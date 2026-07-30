"""Copy caption sidecars into a `.backup` folder, and restore them from it again.

Covers caption sidecars and the caption issues verify-captions writes alongside them.

Both directions are additive: they overwrite files of the same name and never
delete anything, so a backup is a safety net rather than an exact snapshot.
"""

from __future__ import annotations

import argparse
import logging
import shutil
from collections.abc import Callable
from pathlib import Path

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import (
    CAPTION_BACKUP_DIR_NAME,
    CAPTION_SIDECAR_EXTENSIONS,
    ISSUE_SIDECAR_SUFFIX,
    MEDIA_EXTENSIONS,
    SIDECAR_EXTENSIONS,
)
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

# Everything a backup captures for one media file, in a stable order.
BACKUP_SIDECAR_SUFFIXES = (*CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX)


def caption_backup_dir(folder: Path) -> Path:
    return folder / CAPTION_BACKUP_DIR_NAME


def list_backup_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def media_sidecars(media_path: Path) -> list[Path]:
    """Every caption and issue sidecar of ``media_path``, caption JSON first.

    Both caption suffixes are collected rather than just the winning one, so
    restoring reproduces the same precedence that was in effect at backup time.
    """
    candidates = [
        media_path.parent / f"{media_path.stem}{suffix}" for suffix in BACKUP_SIDECAR_SUFFIXES
    ]
    return [path for path in candidates if path.is_file()]


def list_backup_sidecars(folder: Path) -> list[Path]:
    """Caption and issue files sitting in the folder's `.backup` directory."""
    return list_folder_media(caption_backup_dir(folder), SIDECAR_EXTENSIONS, order="name")


def has_caption_backup(folder: Path) -> bool:
    """Whether ``folder`` has anything to restore.

    Stops at the first hit instead of listing the whole backup: every browse
    response reports this, and a backup can hold thousands of sidecars.
    """
    try:
        entries = caption_backup_dir(folder).iterdir()
    except OSError:
        return False

    # Suffix first; it costs nothing, while `is_file` stats the entry.
    return any(entry.suffix.lower() in SIDECAR_EXTENSIONS and entry.is_file() for entry in entries)


def backed_up_media_stem(sidecar: Path) -> str:
    """The media stem ``sidecar`` belongs to, e.g. ``photo`` for ``photo.issue.json``.

    ``Path.stem`` strips only the last suffix, so it would leave ``photo.issue``
    and no media file would ever match it.
    """
    name = sidecar.name
    if name.endswith(ISSUE_SIDECAR_SUFFIX):
        return name[: -len(ISSUE_SIDECAR_SUFFIX)]
    return sidecar.stem


def _has_media_for(folder: Path, sidecar: Path) -> bool:
    stem = backed_up_media_stem(sidecar)
    return any((folder / f"{stem}{extension}").is_file() for extension in MEDIA_EXTENSIONS)


def _select_backup_sidecars(folder: Path, selected_paths: list[Path] | None) -> list[Path]:
    sidecars = list_backup_sidecars(folder)
    if selected_paths is None:
        return sidecars

    selected_stems = {path.stem for path in selected_paths}
    filtered = [sidecar for sidecar in sidecars if backed_up_media_stem(sidecar) in selected_stems]
    if not filtered:
        raise ValueError("No backed up captions found for the selection")
    return filtered


def validate_backup_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    media_files = list_backup_captions_media(folder)
    if not media_files:
        raise ValueError("No supported images or videos found in folder")

    if not any(media_sidecars(media_path) for media_path in media_files):
        raise ValueError("No captions found to back up")


def validate_restore_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not has_caption_backup(folder):
        raise ValueError(f"No caption backup found in {CAPTION_BACKUP_DIR_NAME}")


def run_backup_captions_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_backup_captions_folder(folder)

    media_files = filter_media_list(list_backup_captions_media(folder), selected_paths)
    backup_dir = caption_backup_dir(folder)

    try:
        backup_dir.mkdir(exist_ok=True)
    except OSError as exc:
        raise ValueError(f"Could not create {CAPTION_BACKUP_DIR_NAME} folder: {exc}") from exc

    def process(media_path: Path) -> FileOutcome:
        sidecars = media_sidecars(media_path)
        if not sidecars:
            return FileOutcome(
                status="skipped",
                stats={"skipped": 1},
                fields={"message": "No sidecar to back up"},
            )

        try:
            for sidecar in sidecars:
                shutil.copy2(sidecar, backup_dir / sidecar.name)
        except OSError as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

        return FileOutcome(
            status="success",
            stats={"success": 1, "sidecars": len(sidecars)},
        )

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "sidecars": 0,
            "skipped": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "skipped", "write_error"),
    )


def run_restore_captions_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_restore_captions_folder(folder)

    sidecars = _select_backup_sidecars(folder, selected_paths)

    def process(sidecar: Path) -> FileOutcome:
        if not _has_media_for(folder, sidecar):
            return FileOutcome(
                status="orphaned",
                stats={"orphaned": 1},
                fields={"message": "No media file for this sidecar"},
            )

        try:
            shutil.copy2(sidecar, folder / sidecar.name)
        except OSError as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

        return FileOutcome(status="success", stats={"success": 1})

    return run_media_job(
        folder,
        sidecars,
        stats={
            "total": len(sidecars),
            "success": 0,
            "orphaned": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "orphaned", "write_error"),
    )


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description=f"Back up caption sidecars to {CAPTION_BACKUP_DIR_NAME}, or restore them.",
    )
    parser.add_argument(
        "action",
        choices=("backup", "restore"),
        help="Copy captions and issues into the backup folder, or copy them back out",
    )
    parser.add_argument(
        "folder",
        type=Path,
        help="Folder containing images and/or videos",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    run = run_backup_captions_job if args.action == "backup" else run_restore_captions_job

    try:
        result = run(folder)
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    stat_keys = (
        ("success", "sidecars", "skipped", "write_error")
        if args.action == "backup"
        else ("success", "orphaned", "write_error")
    )
    log_job_summary(logger, result, stat_keys=stat_keys)

    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("write_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
