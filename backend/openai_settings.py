"""Shared OpenAI-compatible vision LLM settings. Reasoning effort is a per-job choice, not an env var."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

DEFAULT_OPENAI_BASE_URL = "http://127.0.0.1:8888/v1"
# SDK requires api_key; local servers do not. "EMPTY" is a filler, not a credential.
DEFAULT_OPENAI_API_KEY = "EMPTY"
DEFAULT_OPENAI_MODEL = "qwen38"

DEFAULT_MAX_TOKENS = 16384
DEFAULT_TOP_K = 20

DEFAULT_TIMEOUT_SECONDS = 600.0
CONNECT_TIMEOUT_SECONDS = 10.0

# 1.0 disables the repetition penalty; the key is omitted from extra_body at this value.
NEUTRAL_REPEAT_PENALTY = 1.0

# Chat template defaults to xhigh and raises on anything else; DataForge sends medium every time.
DEFAULT_REASONING_EFFORT = "medium"
DEFAULT_PRESERVE_THINKING = True


@dataclass(frozen=True)
class SamplingProfile:
    temperature: float
    presence_penalty: float
    top_p: float
    min_p: float
    repeat_penalty: float


THINKING_DEFAULTS = SamplingProfile(
    temperature=1.0,
    presence_penalty=0.0,
    top_p=0.95,
    min_p=0.0,
    repeat_penalty=NEUTRAL_REPEAT_PENALTY,
)
INSTRUCT_DEFAULTS = SamplingProfile(
    temperature=0.7,
    presence_penalty=1.5,
    top_p=0.8,
    min_p=0.0,
    repeat_penalty=NEUTRAL_REPEAT_PENALTY,
)


def _env_str(name: str) -> str:
    return os.environ.get(name, "").strip()


def env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def positive_env_int(name: str, default: int) -> int:
    """Ignore zero and below: they silently disable the thing rather than shrinking it."""
    value = env_int(name, default)
    return value if value > 0 else default


def _env_float(name: str, default: float) -> float:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def get_openai_base_url() -> str:
    return _env_str("OPENAI_API_BASE_URL") or DEFAULT_OPENAI_BASE_URL


def get_openai_api_key() -> str:
    return _env_str("OPENAI_API_KEY") or DEFAULT_OPENAI_API_KEY


def get_openai_model() -> str:
    return _env_str("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL


def get_max_tokens() -> int:
    return env_int("OPENAI_MAX_TOKENS", DEFAULT_MAX_TOKENS)


def get_top_k() -> int:
    return env_int("OPENAI_TOP_K", DEFAULT_TOP_K)


def get_openai_timeout() -> float:
    timeout = _env_float("OPENAI_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)
    return timeout if timeout > 0 else DEFAULT_TIMEOUT_SECONDS


def get_sampling_profile(mode: str) -> SamplingProfile:
    instruct = mode == "instruct"
    defaults = INSTRUCT_DEFAULTS if instruct else THINKING_DEFAULTS
    prefix = "OPENAI_INSTRUCT" if instruct else "OPENAI_THINKING"

    return SamplingProfile(
        temperature=_env_float(f"{prefix}_TEMPERATURE", defaults.temperature),
        presence_penalty=_env_float(f"{prefix}_PRESENCE_PENALTY", defaults.presence_penalty),
        top_p=_env_float(f"{prefix}_TOP_P", defaults.top_p),
        min_p=_env_float(f"{prefix}_MIN_P", defaults.min_p),
        repeat_penalty=_env_float(f"{prefix}_REPEAT_PENALTY", defaults.repeat_penalty),
    )


def build_sampling_extra_body(
    mode: str,
    *,
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
) -> dict[str, object]:
    """``repeat_penalty`` is omitted at 1.0. Reasoning effort is always sent: the template falls back to ``xhigh``."""
    profile = get_sampling_profile(mode)

    extra: dict[str, object] = {
        "top_k": get_top_k(),
        "min_p": profile.min_p,
    }
    if profile.repeat_penalty != NEUTRAL_REPEAT_PENALTY:
        extra["repeat_penalty"] = profile.repeat_penalty
    if mode == "instruct":
        extra["chat_template_kwargs"] = {"enable_thinking": False}
    else:
        extra["chat_template_kwargs"] = {
            "reasoning_effort": effort,
            "preserve_thinking": preserve_thinking,
        }
        extra["reasoning_effort"] = effort

    return extra


def create_openai_client() -> Any:
    """Retries are disabled: ``automation.vision.call_with_retries`` already owns them."""
    import httpx
    from openai import OpenAI

    return OpenAI(
        base_url=get_openai_base_url(),
        api_key=get_openai_api_key(),
        timeout=httpx.Timeout(get_openai_timeout(), connect=CONNECT_TIMEOUT_SECONDS),
        max_retries=0,
    )


def _message_str(message: Any, field: str) -> str:
    value = message.get(field) if isinstance(message, dict) else getattr(message, field, None)
    return value.strip() if isinstance(value, str) else ""


def assistant_message_text(
    message: Any,
    *,
    allow_reasoning_fallback: bool = False,
) -> str:
    """Prefer ``content``. Fallback is instruct-only so Qwen chain-of-thought is never treated as the answer."""
    content = _message_str(message, "content")
    if content:
        return content
    if allow_reasoning_fallback:
        return _message_str(message, "reasoning_content")
    return ""
