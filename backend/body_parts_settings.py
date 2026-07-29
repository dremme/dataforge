"""Body-parts job preferences: the descriptions and keywords last used."""

from __future__ import annotations

from preferences import JsonPreference
from schemas import BodyPartsSettingsResponse

BODY_PARTS_SETTINGS_KEY = "body_parts_settings"

DEFAULT_BODY_DESCRIPTION = "the woman's body"
DEFAULT_FACE_DESCRIPTION = "the woman's face"

_settings: JsonPreference[BodyPartsSettingsResponse] = JsonPreference(
    BODY_PARTS_SETTINGS_KEY, BodyPartsSettingsResponse
)


def parse_keywords(raw: str) -> list[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def resolve_body_description(value: str) -> str:
    return value.strip() or DEFAULT_BODY_DESCRIPTION


def resolve_face_description(value: str) -> str:
    return value.strip() or DEFAULT_FACE_DESCRIPTION


def get_body_parts_settings() -> BodyPartsSettingsResponse:
    return _settings.get()


def update_body_parts_settings(
    *,
    body_description: str | None = None,
    face_description: str | None = None,
    keywords: str | None = None,
    element_description: str | None = None,
) -> BodyPartsSettingsResponse:
    return _settings.update(
        body_description=body_description,
        face_description=face_description,
        keywords=keywords,
        element_description=element_description,
    )
