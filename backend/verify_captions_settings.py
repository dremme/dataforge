"""Verify-captions preferences: global mode + per-folder additional context."""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel, Field

from filesystem import preference_folder_key
from preferences import JsonPreference
from schemas import VerifyCaptionsSettingsResponse

VERIFY_CAPTIONS_SETTINGS_KEY = "verify_captions_settings"

VerifyMode = Literal["thinking", "instruct"]
VALID_MODES = frozenset(get_args(VerifyMode))
DEFAULT_MODE: VerifyMode = "instruct"

# Re-export so callers/tests keep a single import for folder-keyed preferences.
__all__ = [
    "VERIFY_CAPTIONS_SETTINGS_KEY",
    "get_verify_captions_settings",
    "preference_folder_key",
    "update_verify_captions_settings",
]


class VerifyCaptionsStoredSettings(BaseModel):
    """Stored shape: one global mode, plus context keyed by folder.

    A legacy single global ``context`` key is intentionally not migrated onto folders.
    """

    mode: VerifyMode = DEFAULT_MODE
    context_by_folder: dict[str, str] = Field(default_factory=dict)


_settings: JsonPreference[VerifyCaptionsStoredSettings] = JsonPreference(
    VERIFY_CAPTIONS_SETTINGS_KEY, VerifyCaptionsStoredSettings
)


def _response_for(
    stored: VerifyCaptionsStoredSettings,
    folder_key: str,
) -> VerifyCaptionsSettingsResponse:
    return VerifyCaptionsSettingsResponse(
        mode=stored.mode,
        context=stored.context_by_folder.get(folder_key, ""),
        folder_path=folder_key,
    )


def get_verify_captions_settings(*, folder_path: str) -> VerifyCaptionsSettingsResponse:
    """Return mode and context for a folder (empty context when unset for that folder)."""
    return _response_for(_settings.get(), preference_folder_key(folder_path))


def update_verify_captions_settings(
    *,
    mode: str | None = None,
    context: str | None = None,
    folder_path: str,
) -> VerifyCaptionsSettingsResponse:
    """Update the global mode and/or this folder's context. Returns the folder's settings."""
    stored = _settings.get()
    folder_key = preference_folder_key(folder_path)
    contexts = dict(stored.context_by_folder)

    if context is not None:
        if context.strip():
            contexts[folder_key] = context
        else:
            contexts.pop(folder_key, None)

    updated = stored.model_copy(
        update={
            "mode": mode if mode in VALID_MODES else stored.mode,
            "context_by_folder": contexts,
        }
    )
    return _response_for(_settings.save(updated), folder_key)
