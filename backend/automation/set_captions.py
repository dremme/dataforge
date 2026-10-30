"""Utility job to set a fixed caption text on images and videos (creates or updates .txt sidecars)."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_caption_job
from automation.selection import filter_media_list, list_folder_media
from captions import (
    CAPTION_CHANGED_STATUS,
    CAPTION_READ_ERROR,
    NO_CAPTION_STATUS,
    CaptionConflictError,
    CaptionTarget,
    load_reference_caption,
    save_caption_undoably,
)
from constants import MEDIA_EXTENSIONS


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

    def process(target: CaptionTarget) -> FileOutcome:
        reference = load_reference_caption(target.primary)
        if not overwrite:
            # Unreadable is not absent: the bytes may be a caption in another encoding.
            if reference.status == CAPTION_READ_ERROR:
                return FileOutcome.counted(CAPTION_READ_ERROR, "Existing caption could not be read")
            if reference.status != NO_CAPTION_STATUS:
                return FileOutcome.counted("skipped", "Existing caption present")

        try:
            undo = save_caption_undoably(target.primary, text, base_revision=reference.revision)
        except CaptionConflictError as exc:
            return FileOutcome.counted(CAPTION_CHANGED_STATUS, exc)
        except Exception as exc:
            return FileOutcome.counted("write_error", exc)

        return FileOutcome(
            status="success",
            stats={"success": 1},
            fields={"description": text or None},
            undo=undo,
        )

    return run_caption_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "skipped": 0,
            CAPTION_READ_ERROR: 0,
            "write_error": 0,
            CAPTION_CHANGED_STATUS: 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=(
            "success",
            "skipped",
            CAPTION_READ_ERROR,
            "write_error",
            CAPTION_CHANGED_STATUS,
        ),
    )
