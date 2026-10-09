from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query

from automation.edit_captions import preview_caption_edits
from automation.jobs import JobType, job_manager
from automation.replace_captions import preview_caption_replacements
from automation.selection import resolve_selected_media
from automation_settings import remember_job_settings
from comfy_settings import get_comfy_base_url
from external.comfy_client import probe_available, read_log_lines
from external.comfy_workflows import (
    ComfyWorkflowError,
    list_comfy_presets,
    read_comfy_preset_text,
)
from external.ostris_training import (
    OstrisTrainingError,
    parse_training_template,
    read_training_template_text,
)
from routes._helpers import job_response, resolve_folder
from schemas import (
    AutoAdjustStartRequest,
    AutoCaptionStartRequest,
    BackupCaptionsStartRequest,
    BatchRenameStartRequest,
    CheckCaptionRulesStartRequest,
    ComfyLogsResponse,
    ComfyPresetsResponse,
    ComfyPresetSummary,
    ComfyPresetTextResponse,
    ComfyProcessStartRequest,
    EditCaptionsPreviewRequest,
    EditCaptionsPreviewResponse,
    EditCaptionsStartRequest,
    FindDuplicatesStartRequest,
    JobResponse,
    JobSelectionRequest,
    ReplaceCaptionsPreviewRequest,
    ReplaceCaptionsPreviewResponse,
    ReplaceCaptionsStartRequest,
    ResizeStartRequest,
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

FOLDER_QUERY = Query(..., description="Absolute path to the folder the job runs on")


def _start_job(job_type: JobType, path: str, body: JobSelectionRequest) -> JobResponse:
    """Queue ``job_type`` with every field of ``body``, and remember what it ran with."""
    folder = resolve_folder(path)
    try:
        selected_paths = resolve_selected_media(folder, body.paths)
        job = job_manager.queue_job(
            job_type,
            folder,
            selected_paths=selected_paths,
            **body.model_dump(exclude={"paths"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Only a job that actually queued is worth remembering.
    remember_job_settings(job_type, body, folder_path=str(folder))
    return job_response(job)


@router.post("/automation/auto-caption", response_model=JobResponse)
def start_auto_caption(
    path: str = FOLDER_QUERY, body: AutoCaptionStartRequest = AutoCaptionStartRequest()
) -> JobResponse:
    return _start_job("auto_caption", path, body)


@router.post("/automation/set-captions", response_model=JobResponse)
def start_set_captions_job(
    path: str = FOLDER_QUERY, body: SetCaptionsStartRequest = SetCaptionsStartRequest()
) -> JobResponse:
    return _start_job("set_captions", path, body)


@router.post("/automation/replace-captions", response_model=JobResponse)
def start_replace_captions_job(
    path: str = FOLDER_QUERY, body: ReplaceCaptionsStartRequest = ReplaceCaptionsStartRequest()
) -> JobResponse:
    return _start_job("replace_captions", path, body)


@router.post("/automation/replace-captions/preview", response_model=ReplaceCaptionsPreviewResponse)
def preview_replace_captions_job(
    path: str = FOLDER_QUERY,
    body: ReplaceCaptionsPreviewRequest = ReplaceCaptionsPreviewRequest(),
) -> ReplaceCaptionsPreviewResponse:
    """Count the captions the edit would change. POST despite being read-only: regex can be long."""
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
        # An unusable edit is the normal state while typing, so it is a body field, not a 400.
        return ReplaceCaptionsPreviewResponse(folder=str(folder), error=str(exc))

    return ReplaceCaptionsPreviewResponse.model_validate(preview)


@router.post("/automation/find-duplicates", response_model=JobResponse)
def start_find_duplicates_job(
    path: str = FOLDER_QUERY, body: FindDuplicatesStartRequest = FindDuplicatesStartRequest()
) -> JobResponse:
    return _start_job("find_duplicates", path, body)


@router.post("/automation/check-caption-rules", response_model=JobResponse)
def start_check_caption_rules_job(
    path: str = FOLDER_QUERY, body: CheckCaptionRulesStartRequest = CheckCaptionRulesStartRequest()
) -> JobResponse:
    return _start_job("check_caption_rules", path, body)


@router.post("/automation/strip-metadata", response_model=JobResponse)
def start_strip_metadata_job(
    path: str = FOLDER_QUERY, body: StripMetadataStartRequest = StripMetadataStartRequest()
) -> JobResponse:
    return _start_job("strip_metadata", path, body)


@router.post("/automation/batch-rename", response_model=JobResponse)
def start_batch_rename_job(
    path: str = FOLDER_QUERY, body: BatchRenameStartRequest = BatchRenameStartRequest()
) -> JobResponse:
    return _start_job("batch_rename", path, body)


@router.post("/automation/backup-captions", response_model=JobResponse)
def start_backup_captions_job(
    path: str = FOLDER_QUERY, body: BackupCaptionsStartRequest = BackupCaptionsStartRequest()
) -> JobResponse:
    return _start_job("backup_captions", path, body)


@router.post("/automation/auto-adjust", response_model=JobResponse)
def start_auto_adjust_job(
    path: str = FOLDER_QUERY, body: AutoAdjustStartRequest = AutoAdjustStartRequest()
) -> JobResponse:
    return _start_job("auto_adjust", path, body)


@router.post("/automation/resize", response_model=JobResponse)
def start_resize_job(
    path: str = FOLDER_QUERY, body: ResizeStartRequest = ResizeStartRequest()
) -> JobResponse:
    return _start_job("resize", path, body)


@router.post("/automation/restore-captions", response_model=JobResponse)
def start_restore_captions_job(
    path: str = FOLDER_QUERY, body: RestoreCaptionsStartRequest = RestoreCaptionsStartRequest()
) -> JobResponse:
    return _start_job("restore_captions", path, body)


@router.post("/automation/verify-captions", response_model=JobResponse)
def start_verify_captions_job(
    path: str = FOLDER_QUERY, body: VerifyCaptionsStartRequest = VerifyCaptionsStartRequest()
) -> JobResponse:
    return _start_job("verify_captions", path, body)


@router.post("/automation/edit-captions", response_model=JobResponse)
def start_edit_captions_job(
    path: str = FOLDER_QUERY, body: EditCaptionsStartRequest = EditCaptionsStartRequest()
) -> JobResponse:
    return _start_job("edit_captions", path, body)


@router.post("/automation/edit-captions/preview", response_model=EditCaptionsPreviewResponse)
def preview_edit_captions(
    path: str = FOLDER_QUERY,
    body: EditCaptionsPreviewRequest = EditCaptionsPreviewRequest(),
) -> EditCaptionsPreviewResponse:
    folder = resolve_folder(path)
    try:
        selected_paths = resolve_selected_media(folder, body.paths)
        return preview_caption_edits(
            folder,
            selected_paths=selected_paths,
            **body.model_dump(exclude={"paths"}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/automation/watermark", response_model=JobResponse)
def start_watermark_job(
    path: str = FOLDER_QUERY, body: WatermarkStartRequest = WatermarkStartRequest()
) -> JobResponse:
    return _start_job("watermark", path, body)


@router.post("/automation/comfy-process", response_model=JobResponse)
def start_comfy_process_job(
    path: str = FOLDER_QUERY, body: ComfyProcessStartRequest = ComfyProcessStartRequest()
) -> JobResponse:
    return _start_job("comfy_process", path, body)


@router.get("/automation/comfy-process/presets", response_model=ComfyPresetsResponse)
def list_comfy_process_presets() -> ComfyPresetsResponse:
    """Every workflow preset on disk, and whether ComfyUI is answering right now."""
    return ComfyPresetsResponse(
        presets=[
            ComfyPresetSummary(
                name=preset.name,
                modified_at=datetime.fromtimestamp(preset.modified_at, tz=UTC).isoformat(),
                accepts_prompt=preset.accepts_prompt,
                accepts_seed=preset.accepts_seed,
            )
            for preset in list_comfy_presets()
        ],
        available=probe_available(),
        base_url=get_comfy_base_url(),
    )


@router.get("/automation/comfy-process/logs", response_model=ComfyLogsResponse)
def get_comfy_process_logs() -> ComfyLogsResponse:
    """Always a 200: a stopped ComfyUI and one too old to expose its log are both unavailable."""
    lines = read_log_lines()
    if lines is None:
        return ComfyLogsResponse(available=False)

    return ComfyLogsResponse(lines=lines, available=True)


@router.get("/automation/comfy-process/presets/{name}", response_model=ComfyPresetTextResponse)
def get_comfy_process_preset(name: str) -> ComfyPresetTextResponse:
    """One preset's raw JSON, exactly as exported."""
    try:
        return ComfyPresetTextResponse(name=name, content=read_comfy_preset_text(name))
    except ComfyWorkflowError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/automation/train-lora", response_model=JobResponse)
def start_train_lora_job(
    path: str = FOLDER_QUERY, body: TrainLoraStartRequest = TrainLoraStartRequest()
) -> JobResponse:
    return _start_job("train_lora", path, body)


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
    """Whether an edited template would start. A 200 either way; unparseable is the expected answer."""
    try:
        parse_training_template(body.template, source="edited training template")
    except OstrisTrainingError as exc:
        return TrainingTemplateCheckResponse(ok=False, error=str(exc))

    return TrainingTemplateCheckResponse(ok=True)
