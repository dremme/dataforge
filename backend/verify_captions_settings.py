"""Verify-captions preferences: global mode + per-folder additional context."""

from __future__ import annotations

import json

from db import get_preference, set_preference
from filesystem import preference_folder_key

VERIFY_CAPTIONS_SETTINGS_KEY = "verify_captions_settings"

VALID_MODES = frozenset({"thinking", "instruct"})


def _default_settings() -> dict[str, object]:
    return {
        "mode": "instruct",
        "context_by_folder": {},
    }


# Re-export for callers/tests that import from this module.
__all__ = [
    "VALID_MODES",
    "VERIFY_CAPTIONS_SETTINGS_KEY",
    "get_verify_captions_settings",
    "preference_folder_key",
    "update_verify_captions_settings",
]


def _parse_context_by_folder(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    result: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str) and value.strip():
            result[preference_folder_key(key)] = value
    return result


def _load_raw_settings() -> dict[str, object]:
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
    context_by_folder = _parse_context_by_folder(data.get("context_by_folder"))

    # Legacy single global context is intentionally not migrated onto folders.
    return {
        "mode": mode if isinstance(mode, str) and mode in VALID_MODES else "instruct",
        "context_by_folder": context_by_folder,
    }


def get_verify_captions_settings(*, folder_path: str) -> dict[str, str]:
    """Return mode and context for a folder (empty context when unset for that folder)."""
    data = _load_raw_settings()
    mode = str(data["mode"])
    folder_key = preference_folder_key(folder_path)
    contexts = data["context_by_folder"]
    assert isinstance(contexts, dict)
    context = str(contexts.get(folder_key, ""))

    return {
        "mode": mode,
        "context": context,
        "folder_path": folder_key,
    }


def update_verify_captions_settings(
    *,
    mode: str | None = None,
    context: str | None = None,
    folder_path: str,
) -> dict[str, str]:
    """Update global mode and/or per-folder context. Returns settings for the given folder."""
    data = _load_raw_settings()
    contexts = data["context_by_folder"]
    assert isinstance(contexts, dict)
    folder_key = preference_folder_key(folder_path)

    if mode is not None:
        data["mode"] = mode if mode in VALID_MODES else "instruct"

    if context is not None:
        if context.strip() == "":
            contexts.pop(folder_key, None)
        else:
            contexts[folder_key] = context
        data["context_by_folder"] = contexts

    set_preference(VERIFY_CAPTIONS_SETTINGS_KEY, json.dumps(data))

    return {
        "mode": str(data["mode"]),
        "context": str(contexts.get(folder_key, "")),
        "folder_path": folder_key,
    }
