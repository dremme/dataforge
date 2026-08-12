"""Gallery display mode, stored per folder."""

from __future__ import annotations

from typing import cast, get_args

from pydantic import BaseModel, Field

from filesystem import preference_folder_key
from preferences import JsonPreference
from schemas import GalleryDisplayMode, GalleryDisplaySettingsResponse

GALLERY_DISPLAY_SETTINGS_KEY = "gallery_display_settings"

VALID_MODES = frozenset(get_args(GalleryDisplayMode.__value__))
DEFAULT_MODE: GalleryDisplayMode = "large"

# Re-export so callers/tests keep a single import for folder-keyed preferences.
__all__ = [
    "GALLERY_DISPLAY_SETTINGS_KEY",
    "get_gallery_display_settings",
    "preference_folder_key",
    "update_gallery_display_settings",
]


class GalleryDisplayStoredSettings(BaseModel):
    """Stored shape: display mode keyed by folder. Unset folders read as the default."""

    mode_by_folder: dict[str, GalleryDisplayMode] = Field(default_factory=dict)


_settings: JsonPreference[GalleryDisplayStoredSettings] = JsonPreference(
    GALLERY_DISPLAY_SETTINGS_KEY, GalleryDisplayStoredSettings
)


def _response_for(
    stored: GalleryDisplayStoredSettings,
    folder_key: str,
) -> GalleryDisplaySettingsResponse:
    return GalleryDisplaySettingsResponse(
        mode=stored.mode_by_folder.get(folder_key, DEFAULT_MODE),
        folder_path=folder_key,
    )


def get_gallery_display_settings(*, folder_path: str) -> GalleryDisplaySettingsResponse:
    """Return the display mode for a folder (the default when unset for that folder)."""
    return _response_for(_settings.get(), preference_folder_key(folder_path))


def _valid_mode(mode: str | None) -> GalleryDisplayMode | None:
    """Narrow an unvetted mode; anything unknown is ignored rather than stored."""
    return cast(GalleryDisplayMode, mode) if mode in VALID_MODES else None


def update_gallery_display_settings(
    *,
    mode: str | None = None,
    folder_path: str,
) -> GalleryDisplaySettingsResponse:
    """Set this folder's display mode. Returns the folder's settings."""
    stored = _settings.get()
    folder_key = preference_folder_key(folder_path)
    modes = dict(stored.mode_by_folder)
    valid = _valid_mode(mode)

    if valid == DEFAULT_MODE:
        # An absent key already reads as the default; storing it would grow the
        # map by a row for every folder the user merely looked at.
        modes.pop(folder_key, None)
    elif valid is not None:
        modes[folder_key] = valid

    updated = stored.model_copy(update={"mode_by_folder": modes})
    return _response_for(_settings.save(updated), folder_key)
