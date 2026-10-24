"""Copy caption sidecars into a `.backup` folder, and restore them from it again."""

from __future__ import annotations

import os
from pathlib import Path

from automation.job_runner import (
    FileOutcome,
    ProgressCallback,
    ShouldCancel,
    run_caption_job,
    run_media_job,
)
from automation.selection import filter_media_list, list_folder_media
from captions import (
    CAPTION_READ_ERROR,
    CaptionTarget,
    caption_path_for,
    load_backup_caption,
    load_reference_caption,
)
from constants import (
    CAPTION_BACKUP_DIR_NAME,
    CAPTION_CLAIM_WAIT_SECONDS,
    CAPTION_SIDECAR_EXTENSIONS,
    MEDIA_EXTENSIONS,
)
from file_write import copy_file_atomic
from media_claims import claim


def caption_backup_dir(folder: Path) -> Path:
    return folder / CAPTION_BACKUP_DIR_NAME


def list_backup_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def back_up_caption(caption: Path, backup_dir: Path) -> bool:
    """Refresh the backup with the current caption before an edit; False when there is none.

    Called once per caption a job changes, never per file, so a caption same-stem media share
    keeps the text it had before the job.
    """
    if not caption.is_file():
        return False
    target = backup_dir / caption.name
    if target.exists() and not target.is_file():
        raise OSError(f"Caption backup path is not a file: {target.name}")
    copy_file_atomic(caption, target)
    return True


def list_backup_sidecars(folder: Path) -> list[Path]:
    """Caption files sitting in the folder's `.backup` directory."""
    return list_folder_media(
        caption_backup_dir(folder), set(CAPTION_SIDECAR_EXTENSIONS), order="name"
    )


def has_caption_backup(folder: Path) -> bool:
    """Stops at the first caption: the folder watch asks on every scan."""
    try:
        with os.scandir(caption_backup_dir(folder)) as entries:
            return any(_is_caption_file(entry) for entry in entries)
    except OSError:
        return False


def _is_caption_file(entry: os.DirEntry) -> bool:
    try:
        is_file = entry.is_file()
    except OSError:
        return False
    return is_file and Path(entry.name).suffix.lower() in CAPTION_SIDECAR_EXTENSIONS


def _media_for(folder: Path, sidecar: Path) -> Path | None:
    """The media in ``folder`` a caption was written for, or ``None`` once it is gone."""
    for extension in MEDIA_EXTENSIONS:
        media = folder / f"{sidecar.stem}{extension}"
        if media.is_file():
            return media
    return None


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

    if not any(caption_path_for(media_path).is_file() for media_path in media_files):
        raise ValueError("No captions found to back up")


def validate_restore_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not has_caption_backup(folder):
        raise ValueError(f"No caption backup found in {CAPTION_BACKUP_DIR_NAME}")


def _media_version(media: Path) -> str | None:
    """Changes whenever the file does, so a thumbnail URL built from it never goes stale."""
    try:
        stat = media.stat()
    except OSError:
        return None
    return f"{stat.st_mtime_ns}-{stat.st_size}"


def preview_restore_captions(
    folder: Path,
    *,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    """Count what a restore would change, with every differing caption beside its backup.

    Texts are compared stripped, so a backup that differs only in its line endings or
    surrounding whitespace counts as unchanged.
    """
    validate_restore_captions_folder(folder)

    sidecars = _select_backup_sidecars(folder, selected_paths)
    counts: dict[str, int] = {"changed": 0, "missing": 0, "unchanged": 0, "orphaned": 0}
    samples: list[dict[str, object]] = []

    for sidecar in sidecars:
        media = _media_for(folder, sidecar)
        if media is None:
            counts["orphaned"] += 1
            continue

        backup = load_backup_caption(media)
        current, status, _revision = load_reference_caption(media)
        error = None
        if backup is None:
            error = "Could not read the backed up caption"
        elif status == CAPTION_READ_ERROR:
            error = "Could not read the current caption"

        if error is None and (current or "") == backup:
            counts["unchanged"] += 1
            continue

        counts["missing" if error is None and current is None else "changed"] += 1
        samples.append(
            {
                "name": media.name,
                "path": str(media),
                "version": _media_version(media),
                "backup": backup or "",
                "current": current,
                "error": error,
            }
        )

    return {"total": len(sidecars), **counts, "samples": samples}


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

    def process(target: CaptionTarget) -> FileOutcome:
        try:
            if not back_up_caption(target.caption, backup_dir):
                return FileOutcome.counted("skipped", "No sidecar to back up")
        except OSError as exc:
            return FileOutcome.counted("write_error", exc)

        return FileOutcome(status="success", stats={"success": 1, "sidecars": 1})

    return run_caption_job(
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
        if _media_for(folder, sidecar) is None:
            return FileOutcome.counted("orphaned", "No media file for this sidecar")

        live = folder / sidecar.name
        try:
            with claim([live], "caption", wait_s=CAPTION_CLAIM_WAIT_SECONDS):
                copy_file_atomic(sidecar, live)
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
