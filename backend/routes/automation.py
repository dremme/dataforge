from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from automation.jobs import JobType, job_manager
from automation.replace_captions import preview_caption_replacements
from automation.selection import resolve_selected_media
from automation_settings import remember_job_settings
from external.ostris_training import (
    OstrisTrainingError,
    parse_training_template,
    read_training_template_text,
)
from routes._helpers import job_response, resolve_folder
from schemas import (
    AutoCaptionStartRequest,
    BackupCaptionsStartRequest,
    BatchRenameStartRequest,
    EditCaptionsStartRequest,
    FindDuplicatesStartRequest,
    JobResponse,
    JobSelectionRequest,
    ReplaceCaptionsPreviewRequest,
    ReplaceCaptionsPreviewResponse,
    ReplaceCaptionsStartRequest,
    RestoreCaptionsStartRequest,
    SetCaptionsStartRequest,
    StripMetadataStartRequest,
    TrainingModel,
    TrainingTemplateCheckRequest,
    TrainingTemplateCheckResponse,
    TrainingTemplateResponse,
    TrainLoraStartRequest,
    VerifyCaptionsStartRequest,
    WatermarkStartRequest,
)

router = APIRouter()


def _start_job(
    job_type: JobType,
    folder: Path,
    body: JobSelectionRequest,
    **params: object,
) -> JobResponse:
    """Resolve the selection, queue ``job_type``, and remember what it ran with.

    Persisting here rather than in each route is what keeps every job consistent: a
    job type earns per-folder settings by appearing in ``JOB_SETTINGS_MODELS``, not
    by its own route remembering to save.
    """
    try:
        selected_paths = resolve_selected_media(folder, body.paths)
        job = job_manager.queue_job(
            job_type,
            folder,
            selected_paths=selected_paths,
            **params,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Only a job that actually queued is worth remembering: the refusals here are
    # things like empty watermark text and a regex that does not compile.
    remember_job_settings(job_type, body, folder_path=str(folder))
    return job_response(job)


@router.post("/automation/auto-caption", response_model=JobResponse)
def start_auto_caption(
    path: str = Query(..., description="Absolute path to folder with media files"),
    body: AutoCaptionStartRequest = AutoCaptionStartRequest(),
) -> JobResponse:
    return _start_job(
        "auto_caption",
        resolve_folder(path),
        body,
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
        body,
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
        body,
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


@router.post("/automation/find-duplicates", response_model=JobResponse)
def start_find_duplicates_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: FindDuplicatesStartRequest = FindDuplicatesStartRequest(),
) -> JobResponse:
    return _start_job(
        "find_duplicates",
        resolve_folder(path),
        body,
        threshold=body.threshold,
    )


@router.post("/automation/strip-metadata", response_model=JobResponse)
def start_strip_metadata_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: StripMetadataStartRequest = StripMetadataStartRequest(),
) -> JobResponse:
    return _start_job("strip_metadata", resolve_folder(path), body)


@router.post("/automation/batch-rename", response_model=JobResponse)
def start_batch_rename_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BatchRenameStartRequest = BatchRenameStartRequest(),
) -> JobResponse:
    return _start_job(
        "batch_rename",
        resolve_folder(path),
        body,
        stem=body.stem,
        start_number=body.start_number,
    )


@router.post("/automation/backup-captions", response_model=JobResponse)
def start_backup_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: BackupCaptionsStartRequest = BackupCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "backup_captions",
        resolve_folder(path),
        body,
        overwrite=body.overwrite,
    )


@router.post("/automation/restore-captions", response_model=JobResponse)
def start_restore_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: RestoreCaptionsStartRequest = RestoreCaptionsStartRequest(),
) -> JobResponse:
    return _start_job("restore_captions", resolve_folder(path), body)


@router.post("/automation/verify-captions", response_model=JobResponse)
def start_verify_captions_job(
    path: str = Query(..., description="Absolute path to folder with images"),
    body: VerifyCaptionsStartRequest = VerifyCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "verify_captions",
        resolve_folder(path),
        body,
        mode=body.mode,
        reasoning_effort=body.reasoning_effort,
        preserve_thinking=body.preserve_thinking,
        context=body.context,
    )


@router.post("/automation/edit-captions", response_model=JobResponse)
def start_edit_captions_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: EditCaptionsStartRequest = EditCaptionsStartRequest(),
) -> JobResponse:
    return _start_job(
        "edit_captions",
        resolve_folder(path),
        body,
        instruction=body.instruction,
        backup=body.backup,
        mode=body.mode,
        reasoning_effort=body.reasoning_effort,
        preserve_thinking=body.preserve_thinking,
    )


@router.post("/automation/watermark", response_model=JobResponse)
def start_watermark_job(
    path: str = Query(..., description="Absolute path to folder with images and videos"),
    body: WatermarkStartRequest = WatermarkStartRequest(),
) -> JobResponse:
    return _start_job(
        "watermark",
        resolve_folder(path),
        body,
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
        body,
        lora_name=body.lora_name,
        trigger_word=body.trigger_word,
        prompts=body.prompts,
        model=body.model,
        template=body.template,
    )


@router.get("/automation/train-lora/template", response_model=TrainingTemplateResponse)
def get_train_lora_template(
    model: TrainingModel = Query("krea2_turbo", description="Which model's template to read"),
) -> TrainingTemplateResponse:
    """The stock template for a model, for the editor to open."""
    try:
        return TrainingTemplateResponse(model=model, yaml=read_training_template_text(model))
    except OstrisTrainingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/automation/train-lora/template/check", response_model=TrainingTemplateCheckResponse)
def check_train_lora_template(
    body: TrainingTemplateCheckRequest,
) -> TrainingTemplateCheckResponse:
    """Whether an edited template would start.

    A 200 either way: an unparseable draft is the expected answer to this question, not a
    failed request. The start path runs the very same parse, so the two cannot disagree.
    """
    try:
        parse_training_template(body.template, source="edited training template")
    except OstrisTrainingError as exc:
        return TrainingTemplateCheckResponse(ok=False, error=str(exc))

    return TrainingTemplateCheckResponse(ok=True)
