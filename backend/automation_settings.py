"""Automation job settings, remembered per folder with a most-recent fallback.

One preferences row per job type, rather than one blob for all of them: a corrupt
row costs exactly one job its settings, the keys are greppable, and
:class:`~preferences.FolderScopedPreference` stays a clean generic. The combined
read is a handful of tiny local ``SELECT``s; starting a job touches one row.
"""

from __future__ import annotations

from pydantic import BaseModel

from filesystem import preference_folder_key
from preferences import FolderScopedPreference
from schemas import (
    AutoCaptionJobSettings,
    AutomationSettingsResponse,
    BackupCaptionsJobSettings,
    BatchRenameJobSettings,
    FindDuplicatesJobSettings,
    ReplaceCaptionsJobSettings,
    SetCaptionsJobSettings,
    TrainLoraJobSettings,
    VerifyCaptionsJobSettings,
    WatermarkJobSettings,
)

AUTOMATION_SETTINGS_KEY_PREFIX = "automation_settings"

#: Every job whose dialog has settings. The keys are job types and they are also the
#: field names of :class:`~schemas.AutomationSettingsResponse`; ``test_automation_settings``
#: pins the two together, so a new dialog that forgets to register here fails there.
#: ``strip_metadata`` and ``restore_captions`` are absent because they have no dialog.
JOB_SETTINGS_MODELS: dict[str, type[BaseModel]] = {
    "auto_caption": AutoCaptionJobSettings,
    "set_captions": SetCaptionsJobSettings,
    "replace_captions": ReplaceCaptionsJobSettings,
    "backup_captions": BackupCaptionsJobSettings,
    "verify_captions": VerifyCaptionsJobSettings,
    "batch_rename": BatchRenameJobSettings,
    "find_duplicates": FindDuplicatesJobSettings,
    "train_lora": TrainLoraJobSettings,
    "watermark": WatermarkJobSettings,
}

# Re-export so callers/tests keep a single import for folder-keyed preferences.
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
    """Return every job's settings for a folder, falling back to the last used."""
    folder_key = preference_folder_key(folder_path)
    return AutomationSettingsResponse(
        folder_path=folder_key,
        **{job_type: store.get(folder_key) for job_type, store in _STORES.items()},
    )


def remember_job_settings(job_type: str, body: BaseModel, *, folder_path: str) -> None:
    """Store the settings slice of a start request, so the next run starts from it.

    A job type with no registered model is silently skipped, which is what keeps the
    settings-less jobs free. Because every start request inherits its settings model,
    the ``include`` below always covers every field the model declares.
    """
    model = JOB_SETTINGS_MODELS.get(job_type)
    if model is None:
        return

    settings = model.model_validate(body.model_dump(include=set(model.model_fields)))
    _STORES[job_type].save(preference_folder_key(folder_path), settings)
