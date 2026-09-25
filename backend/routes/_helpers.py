from pathlib import Path

from fastapi import HTTPException

from automation import job_outcome
from constants import (
    CANDIDATE_SOURCE_EXTENSIONS,
    GIF_EXTENSION,
    IMAGE_EDIT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    MEDIA_EXTENSIONS,
    VIDEO_EDIT_EXTENSIONS,
)
from filesystem import normalize_user_path, resolve_folder
from schemas import JobResponse

__all__ = [
    "job_response",
    "resolve_candidate_media",
    "resolve_candidate_source",
    "resolve_editable_image",
    "resolve_editable_video",
    "resolve_folder",
    "resolve_gif_file",
    "resolve_image_file",
    "resolve_media_file",
    "resolve_optional_gif_file",
    "resolve_optional_media_file",
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


def resolve_editable_image(path: str) -> Path:
    file_path = resolve_media_file(path)

    if file_path.suffix.lower() not in IMAGE_EDIT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"{file_path.suffix} images cannot be edited",
        )

    return file_path


def resolve_candidate_source(path: str) -> Path:
    """Source path a candidate is keyed by. The file may already be gone."""
    file_path = normalize_user_path(path)
    if file_path.suffix.lower() not in CANDIDATE_SOURCE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported media file")
    return file_path


def resolve_candidate_media(path: str) -> Path:
    """Like `resolve_candidate_source`, for the endpoints that read the file itself."""
    file_path = resolve_media_file(path)
    if file_path.suffix.lower() not in CANDIDATE_SOURCE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"{file_path.suffix} files cannot hold a candidate",
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


def job_response(job) -> JobResponse:
    return job_outcome.job_response(job.to_summary_dict())
