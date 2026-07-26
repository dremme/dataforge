from fastapi import APIRouter, HTTPException, Query

from automation.jobs import job_manager
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


@router.post("/automation/auto-caption", response_model=JobResponse)
def start_auto_caption(
    path: str = Query(..., description="Absolute path to folder with media files"),
    body: AutoCaptionStartRequest = AutoCaptionStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)

    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_auto_caption_job(
            folder,
            mode=body.mode,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


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
    keywords = parse_keywords(body.keywords)

    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_body_parts_job(
            folder,
            body_description=body.body_description,
            face_description=body.face_description,
            keywords=keywords,
            element_description=body.element_description,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


@router.post("/automation/set-captions", response_model=JobResponse)
def start_set_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: SetCaptionsStartRequest = SetCaptionsStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)

    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_set_captions_job(
            folder,
            caption=body.caption,
            overwrite=body.overwrite,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


@router.post("/automation/strip-metadata", response_model=JobResponse)
def start_strip_metadata_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: StripMetadataStartRequest = StripMetadataStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)
    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_strip_metadata_job(folder, selected_paths=selected_paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


@router.post("/automation/batch-rename", response_model=JobResponse)
def start_batch_rename_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BatchRenameStartRequest = BatchRenameStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)
    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_batch_rename_job(
            folder,
            stem=body.stem,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)


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

    selected_paths = resolve_selected_media(folder, body.paths)

    try:
        job = job_manager.queue_verify_captions_job(
            folder,
            mode=body.mode,
            context=body.context,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return job_response(job)
