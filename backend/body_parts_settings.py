import json

from db import get_preference, set_preference

BODY_PARTS_SETTINGS_KEY = "body_parts_settings"


DEFAULT_BODY_DESCRIPTION = "the woman's body"
DEFAULT_FACE_DESCRIPTION = "the woman's face"


def _default_settings() -> dict[str, str]:
    return {
        "body_description": "",
        "face_description": "",
        "keywords": "",
        "element_description": "",
    }


def parse_keywords(raw: str) -> list[str]:
    return [part.strip() for part in raw.split(",") if part.strip()]


def get_body_parts_settings() -> dict[str, str]:
    raw = get_preference(BODY_PARTS_SETTINGS_KEY)
    if not raw:
        return _default_settings()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return _default_settings()

    if not isinstance(data, dict):
        return _default_settings()

    body_description = data.get("body_description")
    face_description = data.get("face_description")
    keywords = data.get("keywords")
    element_description = data.get("element_description")
    return {
        "body_description": body_description if isinstance(body_description, str) else "",
        "face_description": face_description if isinstance(face_description, str) else "",
        "keywords": keywords if isinstance(keywords, str) else "",
        "element_description": element_description if isinstance(element_description, str) else "",
    }


def resolve_body_description(value: str) -> str:
    stripped = value.strip()
    return stripped if stripped else DEFAULT_BODY_DESCRIPTION


def resolve_face_description(value: str) -> str:
    stripped = value.strip()
    return stripped if stripped else DEFAULT_FACE_DESCRIPTION


def update_body_parts_settings(
    *,
    body_description: str | None = None,
    face_description: str | None = None,
    keywords: str | None = None,
    element_description: str | None = None,
) -> dict[str, str]:
    current = get_body_parts_settings()

    if body_description is not None:
        current["body_description"] = body_description
    if face_description is not None:
        current["face_description"] = face_description
    if keywords is not None:
        current["keywords"] = keywords
    if element_description is not None:
        current["element_description"] = element_description

    set_preference(BODY_PARTS_SETTINGS_KEY, json.dumps(current))
    return current
