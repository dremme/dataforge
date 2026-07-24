from pathlib import Path

from fastapi import HTTPException

from constants import IMAGE_EXTENSIONS, MEDIA_EXTENSIONS, SYSPROMPT_FILENAME
from schemas import JobResponse


def resolve_media_file(path: str) -> Path:
    file_path = Path(path).expanduser().resolve()

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")
    if file_path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported media file")

    return file_path


def resolve_image_file(path: str) -> Path:
    file_path = resolve_media_file(path)

    if file_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400, detail="Only image files can be opened in the image viewer"
        )

    return file_path


def resolve_sysprompt_target(path: str) -> Path:
    target = Path(path).expanduser().resolve()

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


def resolve_folder(path: str) -> Path:
    folder = Path(path).expanduser().resolve()

    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")

    return folder


def job_response(job) -> JobResponse:
    return JobResponse(**job.to_dict())
