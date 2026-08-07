"""Watermark preferences: the text and appearance a folder was last watermarked with.

Global rather than folder-keyed, unlike verify-captions context: a watermark identifies
whoever owns the media, so the same one is wanted across folders.
"""

from __future__ import annotations

from preferences import JsonPreference
from schemas import WatermarkSettingsResponse

WATERMARK_SETTINGS_KEY = "watermark_settings"

_settings: JsonPreference[WatermarkSettingsResponse] = JsonPreference(
    WATERMARK_SETTINGS_KEY, WatermarkSettingsResponse
)


def get_watermark_settings() -> WatermarkSettingsResponse:
    return _settings.get()


def update_watermark_settings(
    *,
    text: str | None = None,
    size: str | None = None,
    opacity: int | None = None,
    position: str | None = None,
) -> WatermarkSettingsResponse:
    """Store the given fields; ``None`` leaves a field at its stored value."""
    return _settings.update(text=text, size=size, opacity=opacity, position=position)
