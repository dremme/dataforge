"""Automation job settings, remembered per folder with a most-recent fallback."""

from __future__ import annotations

from pydantic import BaseModel

from filesystem import preference_folder_key
from preferences import FolderScopedPreference
from schemas import (
    AutoCaptionJobSettings,
    AutomationSettingsResponse,
    BackupCaptionsJobSettings,
    BatchRenameJobSettings,
    ComfyProcessJobSettings,
    EditCaptionsJobSettings,
    FindDuplicatesJobSettings,
    ReplaceCaptionsJobSettings,
    SetCaptionsJobSettings,
    TrainLoraJobSettings,
    VerifyCaptionsJobSettings,
    WatermarkJobSettings,
)

AUTOMATION_SETTINGS_KEY_PREFIX = "automation_settings"

#: Keys are job types and field names of AutomationSettingsResponse; jobs with no dialog are absent.
JOB_SETTINGS_MODELS: dict[str, type[BaseModel]] = {
    "auto_caption": AutoCaptionJobSettings,
    "set_captions": SetCaptionsJobSettings,
    "replace_captions": ReplaceCaptionsJobSettings,
    "backup_captions": BackupCaptionsJobSettings,
    "verify_captions": VerifyCaptionsJobSettings,
    "edit_captions": EditCaptionsJobSettings,
    "batch_rename": BatchRenameJobSettings,
    "find_duplicates": FindDuplicatesJobSettings,
    "train_lora": TrainLoraJobSettings,
    "watermark": WatermarkJobSettings,
    "comfy_process": ComfyProcessJobSettings,
}

__all__ = [
    "AUTOMATION_SETTINGS_KEY_PREFIX",
    "JOB_SETTINGS_MODELS",
    "automation_settings_key",
    "get_automation_settings",
    "preference_folder_key",
    "remember_job_settings",
]


def automation_settings_key(job_type: str) -> str:
    return f"{AUTOMATION_SETTINGS_KEY_PREFIX}.{job_type}"


_STORES: dict[str, FolderScopedPreference] = {
    job_type: FolderScopedPreference(automation_settings_key(job_type), model)
    for job_type, model in JOB_SETTINGS_MODELS.items()
}


def get_automation_settings(*, folder_path: str) -> AutomationSettingsResponse:
    folder_key = preference_folder_key(folder_path)
    return AutomationSettingsResponse(
        folder_path=folder_key,
        **{job_type: store.get(folder_key) for job_type, store in _STORES.items()},
    )


def remember_job_settings(job_type: str, body: BaseModel, *, folder_path: str) -> None:
    """A job type with no registered model is skipped, which keeps settings-less jobs free."""
    model = JOB_SETTINGS_MODELS.get(job_type)
    if model is None:
        return

    settings = model.model_validate(body.model_dump(include=set(model.model_fields)))
    _STORES[job_type].save(preference_folder_key(folder_path), settings)
