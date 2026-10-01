"""Copy caption sidecars into a `.backup` folder, and restore them from it again."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import (
    CAPTION_BACKUP_DIR_NAME,
    CAPTION_SIDECAR_EXTENSIONS,
    MEDIA_EXTENSIONS,
)
from file_write import copy_file_atomic


def caption_backup_dir(folder: Path) -> Path:
    return folder / CAPTION_BACKUP_DIR_NAME


def list_backup_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def caption_sidecars(media_path: Path) -> list[Path]:
    candidates = [
        media_path.parent / f"{media_path.stem}{suffix}" for suffix in CAPTION_SIDECAR_EXTENSIONS
    ]
    return [path for path in candidates if path.is_file()]


def list_backup_sidecars(folder: Path) -> list[Path]:
    """Caption files sitting in the folder's `.backup` directory."""
    return list_folder_media(
        caption_backup_dir(folder), set(CAPTION_SIDECAR_EXTENSIONS), order="name"
    )


def has_caption_backup(folder: Path) -> bool:
    return bool(list_backup_sidecars(folder))


def _has_media_for(folder: Path, sidecar: Path) -> bool:
    """Whether the media a caption was written for is still in ``folder``."""
    return any((folder / f"{sidecar.stem}{extension}").is_file() for extension in MEDIA_EXTENSIONS)


def _select_backup_sidecars(folder: Path, selected_paths: list[Path] | None) -> list[Path]:
    sidecars = list_backup_sidecars(folder)
    if selected_paths is None:
        return sidecars

    selected_stems = {path.stem for path in selected_paths}
    filtered = [sidecar for sidecar in sidecars if sidecar.stem in selected_stems]
    if not filtered:
        raise ValueError("No backed up captions found for the selection")
    return filtered


def validate_backup_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    media_files = list_backup_captions_media(folder)
    if not media_files:
        raise ValueError("No supported images or videos found in folder")

    if not any(caption_sidecars(media_path) for media_path in media_files):
        raise ValueError("No captions found to back up")


def validate_restore_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not has_caption_backup(folder):
        raise ValueError(f"No caption backup found in {CAPTION_BACKUP_DIR_NAME}")


def run_backup_captions_job(
    folder: Path,
    *,
    overwrite: bool = False,
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
        sidecars = caption_sidecars(media_path)
        if not sidecars:
            return FileOutcome.counted("skipped", "No sidecar to back up")

        pending = (
            sidecars
            if overwrite
            else [sidecar for sidecar in sidecars if not (backup_dir / sidecar.name).exists()]
        )
        if not pending:
            return FileOutcome.counted("already_backed_up", "Already in the backup")

        try:
            copied = 0
            for sidecar in pending:
                copied += copy_file_atomic(sidecar, backup_dir / sidecar.name, overwrite=overwrite)
        except OSError as exc:
            return FileOutcome.counted("write_error", exc)

        if not copied:
            return FileOutcome.counted("already_backed_up", "Already in the backup")

        return FileOutcome(
            status="success",
            stats={"success": 1, "sidecars": copied},
        )

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "sidecars": 0,
            "already_backed_up": 0,
            "skipped": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "already_backed_up", "skipped", "write_error"),
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
            return FileOutcome.counted("orphaned", "No media file for this sidecar")

        try:
            copy_file_atomic(sidecar, folder / sidecar.name)
        except OSError as exc:
            return FileOutcome.counted("write_error", exc)

        return FileOutcome.counted("success")

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
