import json

from db import get_preference, set_preference

VERIFY_CAPTIONS_SETTINGS_KEY = "verify_captions_settings"

VALID_MODES = frozenset({"thinking", "instruct"})


def _default_settings() -> dict[str, str]:
    return {
        "mode": "instruct",
        "context": "",
    }


def get_verify_captions_settings() -> dict[str, str]:
    raw = get_preference(VERIFY_CAPTIONS_SETTINGS_KEY)
    if not raw:
        return _default_settings()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return _default_settings()

    if not isinstance(data, dict):
        return _default_settings()

    mode = data.get("mode")
    context = data.get("context")
    return {
        "mode": mode if isinstance(mode, str) and mode in VALID_MODES else "instruct",
        "context": context if isinstance(context, str) else "",
    }


def update_verify_captions_settings(
    *,
    mode: str | None = None,
    context: str | None = None,
) -> dict[str, str]:
    current = get_verify_captions_settings()

    if mode is not None:
        current["mode"] = mode if mode in VALID_MODES else "instruct"
    if context is not None:
        current["context"] = context

    set_preference(VERIFY_CAPTIONS_SETTINGS_KEY, json.dumps(current))
    return current
