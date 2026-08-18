from pathlib import Path

from fastapi import HTTPException

from constants import (
    GIF_EXTENSION,
    IMAGE_EXTENSIONS,
    MEDIA_EXTENSIONS,
    SYSPROMPT_FILENAME,
    VIDEO_EDIT_EXTENSIONS,
)
from filesystem import normalize_user_path, resolve_folder
from schemas import JobResponse

# Re-export so route modules keep a single import style.
__all__ = [
    "job_response",
    "resolve_editable_video",
    "resolve_folder",
    "resolve_gif_file",
    "resolve_image_file",
    "resolve_media_file",
    "resolve_optional_gif_file",
    "resolve_optional_media_file",
    "resolve_sysprompt_target",
]


def resolve_optional_media_file(path: str) -> Path | None:
    """Like `resolve_media_file`, but a missing file is an expected outcome, not an error."""
    file_path = normalize_user_path(path)

    if not file_path.is_file():
        return None
    if file_path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported media file")

    return file_path


def resolve_media_file(path: str) -> Path:
    file_path = resolve_optional_media_file(path)

    if file_path is None:
        raise HTTPException(status_code=404, detail="Media file not found")

    return file_path


def resolve_image_file(path: str) -> Path:
    file_path = resolve_media_file(path)

    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail="Only image files can be opened in the image viewer"
        )

    return file_path


def resolve_editable_video(path: str) -> Path:
    file_path = resolve_media_file(path)

    if file_path.suffix.lower() not in VIDEO_EDIT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"{file_path.suffix} videos cannot be edited",
        )

    return file_path


def resolve_optional_gif_file(path: str) -> Path | None:
    """Like `resolve_gif_file`, but a missing file is an expected outcome, not an error."""
    file_path = resolve_optional_media_file(path)

    if file_path is not None and file_path.suffix.lower() != GIF_EXTENSION:
        raise HTTPException(status_code=400, detail="Only GIF files have extractable frames")

    return file_path


def resolve_gif_file(path: str) -> Path:
    file_path = resolve_optional_gif_file(path)

    if file_path is None:
        raise HTTPException(status_code=404, detail="Media file not found")

    return file_path


def resolve_sysprompt_target(path: str) -> Path:
    target = normalize_user_path(path)

    if target.name == SYSPROMPT_FILENAME:
        folder = target.parent
    elif target.is_dir():
        folder = target
    elif not target.exists():
        raise HTTPException(status_code=404, detail="Folder not found")
    else:
        raise HTTPException(status_code=400, detail="Path must be a folder or .sysprompt file")

    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")

    return folder


def job_response(job) -> JobResponse:
    return JobResponse(**job.to_summary_dict())
