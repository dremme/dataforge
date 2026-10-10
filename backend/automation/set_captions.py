"""Utility job to set a fixed caption text on images and videos (creates or updates .txt sidecars)."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_media_job
from automation.selection import filter_media_list, list_folder_media
from captions import (
    CAPTION_READ_ERROR,
    NO_CAPTION_STATUS,
    load_reference_caption,
    save_caption,
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

    def process(media_path: Path) -> FileOutcome:
        if not overwrite:
            _, status = load_reference_caption(media_path)
            # Unreadable is not absent: the bytes may be a caption in another encoding.
            if status == CAPTION_READ_ERROR:
                return FileOutcome.counted("skipped", "Existing caption could not be read")
            if status != NO_CAPTION_STATUS:
                return FileOutcome.counted("skipped", "Existing caption present")

        try:
            save_caption(media_path, text)
        except Exception as exc:
            return FileOutcome.counted("write_error", exc)

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
