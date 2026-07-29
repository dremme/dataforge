"""Gallery UI preferences."""

from __future__ import annotations

from typing import get_args

from preferences import JsonPreference
from schemas import GallerySort, UiSettingsResponse

UI_SETTINGS_KEY = "ui_settings"
DEFAULT_SORT: GallerySort = "name-asc"
VALID_SORTS = frozenset(get_args(GallerySort))

_settings: JsonPreference[UiSettingsResponse] = JsonPreference(UI_SETTINGS_KEY, UiSettingsResponse)


def _normalized_sort(sort: str | None) -> str | None:
    """An unknown sort resets to the default rather than failing the request."""
    if sort is None:
        return None
    return sort if sort in VALID_SORTS else DEFAULT_SORT


def get_ui_settings() -> UiSettingsResponse:
    return _settings.get()


def update_ui_settings(
    *,
    sort: str | None = None,
    show_automation_specs: bool | None = None,
) -> UiSettingsResponse:
    return _settings.update(
        sort=_normalized_sort(sort),
        show_automation_specs=show_automation_specs,
    )
