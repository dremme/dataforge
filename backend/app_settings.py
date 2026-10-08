"""Settings the UI can change without a restart. A saved value outranks the environment, which outranks the default."""

from __future__ import annotations

import math
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, TypeAdapter

from env_file import env_str
from preferences import JsonPreference
from schemas import (
    AppSettingsOverrides,
    AppSettingsResponse,
    AppSettingsUpdate,
    FallbackSource,
    NumberSettingState,
    SecretSettingState,
    TextSettingState,
)

APP_SETTINGS_KEY = "app_settings"
MAX_MODEL_ID_LENGTH = 200
MAX_API_KEY_LENGTH = 500

# The OpenAI SDK requires some key; local servers check none, so this filler means "not set".
NO_API_KEY = "EMPTY"


class InvalidSettingError(ValueError):
    pass


class EffectiveSettings(BaseModel):
    """The values in force; the defaults here are the built-in ones."""

    vision_base_url: str = "http://127.0.0.1:8888/v1"
    vision_api_key: str = NO_API_KEY
    vision_model: str = "qwen38"
    vision_max_tokens: int = 16384
    vision_top_k: int = 20
    draft_caption_threshold: int = 256
    thinking_temperature: float = 1.0
    thinking_top_p: float = 0.95
    thinking_min_p: float = 0.0
    thinking_presence_penalty: float = 0.0
    thinking_repeat_penalty: float = 1.0
    instruct_temperature: float = 0.7
    instruct_top_p: float = 0.8
    instruct_min_p: float = 0.0
    instruct_presence_penalty: float = 1.5
    instruct_repeat_penalty: float = 1.0
    image_max_pixels: int = 1_500_000
    video_keyframes_per_second: int = 2
    # Every frame is inlined; 2 * 20s + 2 endpoints is as long as current vision models take.
    video_max_keyframes: int = 42
    video_frame_max_pixels: int = 500_000
    # Qwen's 512 x 512 floor: below it both sides floor and a 16:9 frame comes out square.
    video_frame_min_pixels: int = 512 * 512
    comfy_base_url: str = "http://127.0.0.1:9000"
    ai_toolkit_base_url: str = "http://127.0.0.1:8675"
    thumbnail_cache_max_mb: int = 2048
    job_history_days: int = 30
    notification_history_days: int = 3


SETTING_DEFAULTS = EffectiveSettings()


def validate_url(value: str) -> str:
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


def _api_key(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ValueError("must not be empty")
    if len(candidate) > MAX_API_KEY_LENGTH or any(char.isspace() for char in candidate):
        raise ValueError(f"must be one word of at most {MAX_API_KEY_LENGTH} characters")
    return candidate


@dataclass(frozen=True)
class _Range:
    minimum: float
    maximum: float | None = None

    def __call__(self, value: float) -> float:
        above = self.maximum is not None and value > self.maximum
        if not math.isfinite(value) or value < self.minimum or above:
            limit = f" and at most {self.maximum:g}" if self.maximum is not None else ""
            raise ValueError(f"must be at least {self.minimum:g}{limit}")
        return value


@dataclass(frozen=True)
class _Rule:
    label: str
    env_var: str
    check: Callable[[Any], Any]


def _sampling_rules(mode: str, label: str) -> dict[str, _Rule]:
    prefix = f"OPENAI_{mode.upper()}"
    return {
        f"{mode}_temperature": _Rule(f"{label} temperature", f"{prefix}_TEMPERATURE", _Range(0, 2)),
        f"{mode}_top_p": _Rule(f"{label} top-p", f"{prefix}_TOP_P", _Range(0.01, 1)),
        f"{mode}_min_p": _Rule(f"{label} min-p", f"{prefix}_MIN_P", _Range(0, 1)),
        f"{mode}_presence_penalty": _Rule(
            f"{label} presence penalty", f"{prefix}_PRESENCE_PENALTY", _Range(-2, 2)
        ),
        f"{mode}_repeat_penalty": _Rule(
            f"{label} repeat penalty", f"{prefix}_REPEAT_PENALTY", _Range(0, 2)
        ),
    }


_RULES: dict[str, _Rule] = {
    "vision_base_url": _Rule("Vision server URL", "OPENAI_API_BASE_URL", validate_url),
    "vision_api_key": _Rule("API key", "OPENAI_API_KEY", _api_key),
    "vision_model": _Rule("Vision model", "OPENAI_MODEL", _model_id),
    "vision_max_tokens": _Rule("Max tokens", "OPENAI_MAX_TOKENS", _Range(1)),
    "vision_top_k": _Rule("Top-k", "OPENAI_TOP_K", _Range(0)),
    "draft_caption_threshold": _Rule(
        "Draft caption threshold", "DRAFT_CAPTION_THRESHOLD", _Range(1)
    ),
    **_sampling_rules("thinking", "Reasoning"),
    **_sampling_rules("instruct", "Instruct"),
    "image_max_pixels": _Rule("Image pixel budget", "IMAGE_MAX_PIXELS", _Range(1)),
    "video_keyframes_per_second": _Rule(
        "Keyframes per second", "VIDEO_KEYFRAMES_PER_SECOND", _Range(1)
    ),
    "video_max_keyframes": _Rule("Max keyframes", "VIDEO_MAX_KEYFRAMES", _Range(1)),
    "video_frame_max_pixels": _Rule(
        "Frame pixel budget, short clips", "VIDEO_FRAME_MAX_PIXELS", _Range(1)
    ),
    "video_frame_min_pixels": _Rule(
        "Frame pixel budget, long clips", "VIDEO_FRAME_MIN_PIXELS", _Range(1)
    ),
    "comfy_base_url": _Rule("ComfyUI URL", "COMFY_BASE_URL", validate_url),
    "ai_toolkit_base_url": _Rule("AI-Toolkit URL", "OSTRIS_BASE_URL", validate_url),
    "thumbnail_cache_max_mb": _Rule(
        "Thumbnail cache limit", "DATAFORGE_THUMBNAIL_CACHE_MAX_MB", _Range(0)
    ),
    "job_history_days": _Rule("Job history", "DATAFORGE_JOB_HISTORY_DAYS", _Range(0)),
    "notification_history_days": _Rule(
        "Notification history", "DATAFORGE_NOTIFICATION_HISTORY_DAYS", _Range(0)
    ),
}

_PARSERS = {
    key: TypeAdapter(field.annotation or Any)
    for key, field in EffectiveSettings.model_fields.items()
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


def _fallback(key: str) -> tuple[Any, FallbackSource]:
    raw = env_str(_RULES[key].env_var)
    if raw:
        try:
            return _RULES[key].check(_PARSERS[key].validate_python(raw)), "env"
        except ValueError:
            pass
    return getattr(SETTING_DEFAULTS, key), "default"


def effective_settings() -> EffectiveSettings:
    return EffectiveSettings.model_construct(
        **{key: _saved[key] if key in _saved else _fallback(key)[0] for key in _RULES}
    )


def _state(key: str) -> TextSettingState | NumberSettingState | SecretSettingState:
    rule = _RULES[key]
    fallback, fallback_source = _fallback(key)
    value = _saved.get(key, fallback)
    source = "saved" if key in _saved else fallback_source
    if key == "vision_api_key":
        return SecretSettingState(
            is_set=value != NO_API_KEY, source=source, fallback_source=fallback_source
        )
    state = {
        "value": value,
        "source": source,
        "fallback": fallback,
        "fallback_source": fallback_source,
    }
    if isinstance(rule.check, _Range):
        return NumberSettingState.model_validate(
            {**state, "minimum": rule.check.minimum, "maximum": rule.check.maximum}
        )
    return TextSettingState.model_validate(state)


def describe_app_settings() -> AppSettingsResponse:
    return AppSettingsResponse.model_validate({key: _state(key) for key in _RULES})


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
