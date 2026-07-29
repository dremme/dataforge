from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from automation.jobs import JobType, job_manager
from automation.selection import resolve_selected_media
from body_parts_settings import parse_keywords, update_body_parts_settings
from routes._helpers import job_response, resolve_folder
from schemas import (
    AutoCaptionStartRequest,
    BatchRenameStartRequest,
    BodyPartsStartRequest,
    JobResponse,
    SetCaptionsStartRequest,
    StripMetadataStartRequest,
    VerifyCaptionsStartRequest,
)
from verify_captions_settings import update_verify_captions_settings

router = APIRouter()


def _start_job(
    job_type: JobType,
    folder: Path,
    paths: list[str] | None,
    **params: object,
) -> JobResponse:
    """Resolve the selection and queue ``job_type``, mapping refusals onto 400s."""
    try:
        selected_paths = resolve_selected_media(folder, paths)
        job = job_manager.queue_job(
            job_type,
            folder,
            selected_paths=selected_paths,
            **params,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


@router.post("/automation/auto-caption", response_model=JobResponse)
def start_auto_caption(
    path: str = Query(..., description="Absolute path to folder with media files"),
    body: AutoCaptionStartRequest = AutoCaptionStartRequest(),
) -> JobResponse:
    return _start_job("auto_caption", resolve_folder(path), body.paths, mode=body.mode)


@router.post("/automation/body-parts", response_model=JobResponse)
def start_body_parts_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BodyPartsStartRequest = BodyPartsStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)

    update_body_parts_settings(
        body_description=body.body_description,
        face_description=body.face_description,
        keywords=body.keywords,
        element_description=body.element_description,
    )

    return _start_job(
        "body_parts",
        folder,
        body.paths,
        body_description=body.body_description,
        face_description=body.face_description,
        keywords=parse_keywords(body.keywords),
        element_description=body.element_description,
    )


@router.post("/automation/set-captions", response_model=JobResponse)
def start_set_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: SetCaptionsStartRequest = SetCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "set_captions",
        resolve_folder(path),
        body.paths,
        caption=body.caption,
        overwrite=body.overwrite,
    )


@router.post("/automation/strip-metadata", response_model=JobResponse)
def start_strip_metadata_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: StripMetadataStartRequest = StripMetadataStartRequest(),
) -> JobResponse:
    return _start_job("strip_metadata", resolve_folder(path), body.paths)


@router.post("/automation/batch-rename", response_model=JobResponse)
def start_batch_rename_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BatchRenameStartRequest = BatchRenameStartRequest(),
) -> JobResponse:
    return _start_job("batch_rename", resolve_folder(path), body.paths, stem=body.stem)


@router.post("/automation/verify-captions", response_model=JobResponse)
def start_verify_captions_job(
    path: str = Query(..., description="Absolute path to folder with images"),
    body: VerifyCaptionsStartRequest = VerifyCaptionsStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)

    update_verify_captions_settings(
        mode=body.mode,
        context=body.context,
        folder_path=str(folder),
    )

    return _start_job(
        "verify_captions",
        folder,
        body.paths,
        mode=body.mode,
        context=body.context,
    )
