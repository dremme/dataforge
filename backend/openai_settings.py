"""Shared OpenAI-compatible vision LLM settings for auto-caption and verify jobs.

Environment (all optional):

- ``OPENAI_API_BASE_URL`` — base URL of the OpenAI-compatible server
- ``OPENAI_API_KEY`` — API key (placeholder is fine for many local servers)
- ``OPENAI_MODEL`` — chat ``model`` id the server expects
- ``OPENAI_MAX_TOKENS`` — completion max tokens
- ``OPENAI_TIMEOUT`` — seconds to wait for a model response before giving up
- ``OPENAI_THINKING_TEMPERATURE`` / ``OPENAI_THINKING_PRESENCE_PENALTY`` / ``OPENAI_THINKING_TOP_P`` / ``OPENAI_THINKING_MIN_P`` / ``OPENAI_THINKING_REPEAT_PENALTY``
- ``OPENAI_INSTRUCT_TEMPERATURE`` / ``OPENAI_INSTRUCT_PRESENCE_PENALTY`` / ``OPENAI_INSTRUCT_TOP_P`` / ``OPENAI_INSTRUCT_MIN_P`` / ``OPENAI_INSTRUCT_REPEAT_PENALTY``
- ``OPENAI_TOP_K`` / min-p / repeat-penalty vars — sampling extras via ``extra_body`` (local servers)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

DEFAULT_OPENAI_BASE_URL = "http://127.0.0.1:1234/v1"
DEFAULT_OPENAI_API_KEY = "sk-1234"
DEFAULT_OPENAI_MODEL = "qwen35moe"

DEFAULT_MAX_TOKENS = 8192
DEFAULT_TOP_K = 20

# Generous enough for a slow local GPU working through a long thinking-mode generation.
DEFAULT_TIMEOUT_SECONDS = 600.0
# A model server that is up answers the handshake immediately; one that is not should
# fail fast rather than sit in the response budget.
CONNECT_TIMEOUT_SECONDS = 10.0

# 1.0 disables the repetition penalty, so it is both the default and the value
# at which the key is left out of ``extra_body`` entirely.
NEUTRAL_REPEAT_PENALTY = 1.0


@dataclass(frozen=True)
class SamplingProfile:
    """Sampling knobs for one generation mode."""

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


def _env_int(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


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
    return _env_int("OPENAI_MAX_TOKENS", DEFAULT_MAX_TOKENS)


def get_top_k() -> int:
    return _env_int("OPENAI_TOP_K", DEFAULT_TOP_K)


def get_openai_timeout() -> float:
    timeout = _env_float("OPENAI_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)
    return timeout if timeout > 0 else DEFAULT_TIMEOUT_SECONDS


def get_sampling_profile(mode: str) -> SamplingProfile:
    """Env-configured sampling knobs for ``mode``. Unknown modes fall back to thinking."""
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


def build_sampling_extra_body(mode: str) -> dict[str, object]:
    """Sampling knobs local servers accept outside the OpenAI chat schema.

    ``repeat_penalty`` is the llama.cpp / LM Studio name for the knob Hugging
    Face and vLLM call ``repetition_penalty``. It is only sent once configured
    away from its neutral 1.0, so servers that do not recognise the key keep
    seeing exactly the request they saw before the setting existed.
    """
    profile = get_sampling_profile(mode)

    extra: dict[str, object] = {
        "top_k": get_top_k(),
        "min_p": profile.min_p,
    }
    if profile.repeat_penalty != NEUTRAL_REPEAT_PENALTY:
        extra["repeat_penalty"] = profile.repeat_penalty
    if mode == "instruct":
        extra["chat_template_kwargs"] = {"enable_thinking": False}

    return extra


def create_openai_client() -> Any:
    """Return an OpenAI client configured from environment / defaults.

    Retries are disabled because ``automation.vision.call_with_retries`` already owns
    them; the SDK default would silently turn every attempt into three HTTP requests,
    multiplying how long a wedged server can hold a job hostage.
    """
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
    """Prefer ``content``; optionally fall back to ``reasoning_content`` if empty.

    Fallback is for instruct mode only (e.g. LM Studio + Gemma). Thinking mode
    must use ``content`` only so Qwen chain-of-thought is never treated as the answer.
    """
    content = _message_str(message, "content")
    if content:
        return content
    if allow_reasoning_fallback:
        return _message_str(message, "reasoning_content")
    return ""
