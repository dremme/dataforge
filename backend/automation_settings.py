"""Automation job settings, remembered per folder with a most-recent fallback.

ComfyUI processing is the exception: its prompt and seed are remembered per workflow preset.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from filesystem import preference_folder_key
from preferences import FolderScopedPreference, JsonPreference, validate_or_salvage
from schemas import (
    AutoCaptionJobSettings,
    AutomationSettingsResponse,
    BackupCaptionsJobSettings,
    BatchRenameJobSettings,
    ComfyPresetSettings,
    ComfyProcessJobSettings,
    ComfyProcessSettingsResponse,
    EditCaptionsJobSettings,
    FindDuplicatesJobSettings,
    ReplaceCaptionsJobSettings,
    SetCaptionsJobSettings,
    TrainLoraJobSettings,
    VerifyCaptionsJobSettings,
    WatermarkJobSettings,
)

AUTOMATION_SETTINGS_KEY_PREFIX = "automation_settings"
COMFY_PROCESS_JOB_TYPE = "comfy_process"

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
}

__all__ = [
    "AUTOMATION_SETTINGS_KEY_PREFIX",
    "COMFY_PROCESS_JOB_TYPE",
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


class _ComfyFolderSettings(BaseModel):
    overwrite_candidates: bool = False


# The per-folder half keeps the job's original key, so earlier saves still read back.
_COMFY_FOLDER_STORE: FolderScopedPreference[_ComfyFolderSettings] = FolderScopedPreference(
    automation_settings_key(COMFY_PROCESS_JOB_TYPE), _ComfyFolderSettings
)


class _ComfyProcessEnvelope(BaseModel):
    """Payloads stay untyped so one corrupt preset cannot fail the rest."""

    preset: str = ""
    by_preset: dict[str, dict[str, object]] = Field(default_factory=dict)


_COMFY_STORE: JsonPreference[_ComfyProcessEnvelope] = JsonPreference(
    f"{automation_settings_key(COMFY_PROCESS_JOB_TYPE)}.presets", _ComfyProcessEnvelope
)


def _get_comfy_process_settings(folder_key: str) -> ComfyProcessSettingsResponse:
    envelope = _COMFY_STORE.get()
    return ComfyProcessSettingsResponse(
        preset=envelope.preset,
        overwrite_candidates=_COMFY_FOLDER_STORE.get(folder_key).overwrite_candidates,
        by_preset={
            name: validate_or_salvage(ComfyPresetSettings, payload)
            for name, payload in envelope.by_preset.items()
        },
    )


def _remember_comfy_process_settings(body: BaseModel, folder_key: str) -> None:
    run = ComfyProcessJobSettings.model_validate(
        body.model_dump(include=set(ComfyProcessJobSettings.model_fields))
    )
    _COMFY_FOLDER_STORE.save(
        folder_key, _ComfyFolderSettings(overwrite_candidates=run.overwrite_candidates)
    )
    payload = run.model_dump(mode="json", include=set(ComfyPresetSettings.model_fields))
    envelope = _COMFY_STORE.get()
    _COMFY_STORE.save(
        _ComfyProcessEnvelope(
            preset=run.preset, by_preset={**envelope.by_preset, run.preset: payload}
        )
    )


def get_automation_settings(*, folder_path: str) -> AutomationSettingsResponse:
    folder_key = preference_folder_key(folder_path)
    return AutomationSettingsResponse(
        folder_path=folder_key,
        comfy_process=_get_comfy_process_settings(folder_key),
        **{job_type: store.get(folder_key) for job_type, store in _STORES.items()},
    )


def remember_job_settings(job_type: str, body: BaseModel, *, folder_path: str) -> None:
    """A job type with no registered model is skipped, which keeps settings-less jobs free."""
    if job_type == COMFY_PROCESS_JOB_TYPE:
        _remember_comfy_process_settings(body, preference_folder_key(folder_path))
        return

    model = JOB_SETTINGS_MODELS.get(job_type)
    if model is None:
        return

    settings = model.model_validate(body.model_dump(include=set(model.model_fields)))
    _STORES[job_type].save(preference_folder_key(folder_path), settings)
