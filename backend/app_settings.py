"""Settings the UI can change without a restart. A saved value outranks the environment, which outranks the default."""

from __future__ import annotations

import math
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, TypeAdapter

from db import get_db_path
from env_file import env_str, loaded_env_file
from preferences import JsonPreference
from schemas import (
    AppSettingKey,
    AppSettingsOverrides,
    AppSettingsResponse,
    AppSettingsUpdate,
    FallbackSource,
    NumberSettingState,
    TextSettingState,
)

APP_SETTINGS_KEY = "app_settings"
MAX_MODEL_ID_LENGTH = 200


class InvalidSettingError(ValueError):
    pass


class EffectiveSettings(BaseModel):
    """The values in force; the defaults here are the built-in ones."""

    vision_base_url: str = "http://127.0.0.1:8888/v1"
    vision_model: str = "qwen38"
    vision_timeout_seconds: float = 600.0
    draft_caption_threshold: int = 256
    comfy_base_url: str = "http://127.0.0.1:9000"
    ai_toolkit_base_url: str = "http://127.0.0.1:8675"
    thumbnail_cache_max_mb: int = 2048


def _url(value: str) -> str:
    candidate = value.strip()
    parts = urlsplit(candidate)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("must be an http:// or https:// URL with a host")
    try:
        port = parts.port
    except ValueError:
        port = 0
    if port == 0:
        raise ValueError("must use a port from 1 to 65535")
    return candidate.rstrip("/")


def _model_id(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ValueError("must not be empty")
    if len(candidate) > MAX_MODEL_ID_LENGTH:
        raise ValueError(f"must be at most {MAX_MODEL_ID_LENGTH} characters")
    return candidate


def _positive_seconds(value: float) -> float:
    if not math.isfinite(value) or value <= 0:
        raise ValueError("must be more than 0 seconds")
    return value


def _at_least(minimum: int) -> Callable[[int], int]:
    def check(value: int) -> int:
        if value < minimum:
            raise ValueError(f"must be at least {minimum}")
        return value

    return check


@dataclass(frozen=True)
class _Rule:
    label: str
    env_var: str
    check: Callable[[Any], Any]


_RULES: dict[AppSettingKey, _Rule] = {
    "vision_base_url": _Rule("Vision server URL", "OPENAI_API_BASE_URL", _url),
    "vision_model": _Rule("Vision model", "OPENAI_MODEL", _model_id),
    "vision_timeout_seconds": _Rule("Vision timeout", "OPENAI_TIMEOUT", _positive_seconds),
    "draft_caption_threshold": _Rule(
        "Draft caption threshold", "DRAFT_CAPTION_THRESHOLD", _at_least(1)
    ),
    "comfy_base_url": _Rule("ComfyUI URL", "COMFY_BASE_URL", _url),
    "ai_toolkit_base_url": _Rule("AI-Toolkit URL", "OSTRIS_BASE_URL", _url),
    "thumbnail_cache_max_mb": _Rule(
        "Thumbnail cache limit", "DATAFORGE_THUMBNAIL_CACHE_MAX_MB", _at_least(0)
    ),
}

_DEFAULTS = EffectiveSettings()
_PARSERS = {
    key: TypeAdapter(field.annotation) for key, field in EffectiveSettings.model_fields.items()
}

_store: JsonPreference[AppSettingsOverrides] = JsonPreference(
    APP_SETTINGS_KEY, AppSettingsOverrides
)
_write_lock = threading.Lock()
# Getters run per request and per file; a validated snapshot keeps them off the database.
_saved: dict[str, Any] = {}


def _checked(stored: AppSettingsOverrides) -> dict[str, Any]:
    valid: dict[str, Any] = {}
    for key, value in stored.model_dump(exclude_none=True).items():
        try:
            valid[key] = _RULES[key].check(value)
        except ValueError:
            continue
    return valid


def load_saved_settings() -> None:
    global _saved
    _saved = _checked(_store.get())


def _fallback(key: AppSettingKey) -> tuple[Any, FallbackSource]:
    raw = env_str(_RULES[key].env_var)
    if raw:
        try:
            return _RULES[key].check(_PARSERS[key].validate_python(raw)), "env"
        except ValueError:
            pass
    return getattr(_DEFAULTS, key), "default"


def effective_settings() -> EffectiveSettings:
    return EffectiveSettings.model_construct(
        **{key: _saved[key] if key in _saved else _fallback(key)[0] for key in _RULES}
    )


def describe_app_settings() -> AppSettingsResponse:
    states: dict[str, TextSettingState | NumberSettingState] = {}
    for key in _RULES:
        fallback, fallback_source = _fallback(key)
        state = TextSettingState if isinstance(fallback, str) else NumberSettingState
        states[key] = state.model_validate(
            {
                "value": _saved.get(key, fallback),
                "source": "saved" if key in _saved else fallback_source,
                "fallback": fallback,
                "fallback_source": fallback_source,
            }
        )

    loaded = loaded_env_file()
    return AppSettingsResponse.model_validate(
        {
            **states,
            "database_path": str(get_db_path()),
            "env_file": str(loaded) if loaded else None,
        }
    )


def _validated_changes(update: AppSettingsUpdate) -> dict[str, Any]:
    changes: dict[str, Any] = dict.fromkeys(update.reset)
    for key, value in update.model_dump(exclude={"reset"}, exclude_none=True).items():
        rule = _RULES[key]
        try:
            changes[key] = rule.check(value)
        except ValueError as error:
            raise InvalidSettingError(f"{rule.label} {error}.") from None
    return changes


def update_app_settings(update: AppSettingsUpdate) -> AppSettingsResponse:
    global _saved
    changes = _validated_changes(update)
    with _write_lock:
        _saved = _checked(_store.save(_store.get().model_copy(update=changes)))
    return describe_app_settings()
