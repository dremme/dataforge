from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from automation.jobs import JobType, job_manager
from automation.replace_captions import preview_caption_replacements
from automation.selection import resolve_selected_media
from routes._helpers import job_response, resolve_folder
from schemas import (
    AutoCaptionStartRequest,
    BackupCaptionsStartRequest,
    BatchRenameStartRequest,
    JobResponse,
    ReplaceCaptionsPreviewRequest,
    ReplaceCaptionsPreviewResponse,
    ReplaceCaptionsStartRequest,
    RestoreCaptionsStartRequest,
    SetCaptionsStartRequest,
    StripMetadataStartRequest,
    TrainLoraStartRequest,
    VerifyCaptionsStartRequest,
    WatermarkStartRequest,
)
from verify_captions_settings import update_verify_captions_settings
from watermark_settings import update_watermark_settings

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
    return _start_job(
        "auto_caption",
        resolve_folder(path),
        body.paths,
        mode=body.mode,
        reasoning_effort=body.reasoning_effort,
        preserve_thinking=body.preserve_thinking,
        caption_audio=body.caption_audio,
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


@router.post("/automation/replace-captions", response_model=JobResponse)
def start_replace_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: ReplaceCaptionsStartRequest = ReplaceCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "replace_captions",
        resolve_folder(path),
        body.paths,
        mode=body.mode,
        search=body.search,
        replacement=body.replacement,
        use_regex=body.use_regex,
        case_sensitive=body.case_sensitive,
    )


@router.post("/automation/replace-captions/preview", response_model=ReplaceCaptionsPreviewResponse)
def preview_replace_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: ReplaceCaptionsPreviewRequest = ReplaceCaptionsPreviewRequest(),
) -> ReplaceCaptionsPreviewResponse:
    """Count the captions the edit would change. POST despite being read-only:
    a regular expression is awkward to encode in a query string and can be long.
    """
    folder = resolve_folder(path)

    try:
        selected_paths = resolve_selected_media(folder, body.paths)
        preview = preview_caption_replacements(
            folder,
            mode=body.mode,
            search=body.search,
            replacement=body.replacement,
            use_regex=body.use_regex,
            case_sensitive=body.case_sensitive,
            selected_paths=selected_paths,
        )
    except ValueError as exc:
        # An unusable edit is the normal state while typing, so it is a body field
        # rather than a 400 the dialog would have to special-case.
        return ReplaceCaptionsPreviewResponse(folder=str(folder), error=str(exc))

    return ReplaceCaptionsPreviewResponse(**preview)


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


@router.post("/automation/backup-captions", response_model=JobResponse)
def start_backup_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BackupCaptionsStartRequest = BackupCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "backup_captions",
        resolve_folder(path),
        body.paths,
        overwrite=body.overwrite,
    )


@router.post("/automation/restore-captions", response_model=JobResponse)
def start_restore_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: RestoreCaptionsStartRequest = RestoreCaptionsStartRequest(),
) -> JobResponse:
    return _start_job("restore_captions", resolve_folder(path), body.paths)


@router.post("/automation/verify-captions", response_model=JobResponse)
def start_verify_captions_job(
    path: str = Query(..., description="Absolute path to folder with images"),
    body: VerifyCaptionsStartRequest = VerifyCaptionsStartRequest(),
) -> JobResponse:
    folder = resolve_folder(path)

    update_verify_captions_settings(
        mode=body.mode,
        reasoning_effort=body.reasoning_effort,
        preserve_thinking=body.preserve_thinking,
        context=body.context,
        folder_path=str(folder),
    )

    return _start_job(
        "verify_captions",
        folder,
        body.paths,
        mode=body.mode,
        reasoning_effort=body.reasoning_effort,
        preserve_thinking=body.preserve_thinking,
        context=body.context,
    )


@router.post("/automation/watermark", response_model=JobResponse)
def start_watermark_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: WatermarkStartRequest = WatermarkStartRequest(),
) -> JobResponse:
    update_watermark_settings(
        text=body.text, size=body.size, opacity=body.opacity, position=body.position
    )

    return _start_job(
        "watermark",
        resolve_folder(path),
        body.paths,
        text=body.text,
        size=body.size,
        opacity=body.opacity,
        position=body.position,
    )


@router.post("/automation/train-lora", response_model=JobResponse)
def start_train_lora_job(
    path: str = Query(..., description="Absolute path to the folder to train on"),
    body: TrainLoraStartRequest = TrainLoraStartRequest(),
) -> JobResponse:
    return _start_job(
        "train_lora",
        resolve_folder(path),
        body.paths,
        lora_name=body.lora_name,
        trigger_word=body.trigger_word,
        prompts=body.prompts,
    )
