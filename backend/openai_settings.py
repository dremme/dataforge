"""Shared OpenAI-compatible vision LLM settings for auto-caption and verify jobs.

Environment (all optional):

- ``OPENAI_API_BASE_URL`` — base URL of the OpenAI-compatible server
- ``OPENAI_API_KEY`` — API key (placeholder is fine for many local servers)
- ``OPENAI_MODEL`` — chat ``model`` id the server expects
- ``OPENAI_MAX_TOKENS`` — completion max tokens
- ``OPENAI_THINKING_TEMPERATURE`` / ``OPENAI_THINKING_PRESENCE_PENALTY`` / ``OPENAI_THINKING_TOP_P`` / ``OPENAI_THINKING_MIN_P`` / ``OPENAI_THINKING_REPEAT_PENALTY``
- ``OPENAI_INSTRUCT_TEMPERATURE`` / ``OPENAI_INSTRUCT_PRESENCE_PENALTY`` / ``OPENAI_INSTRUCT_TOP_P`` / ``OPENAI_INSTRUCT_MIN_P`` / ``OPENAI_INSTRUCT_REPEAT_PENALTY``
- ``OPENAI_TOP_K`` / min-p / repeat-penalty vars — sampling extras via ``extra_body`` (local servers)
"""

from __future__ import annotations

import os
from typing import Any

DEFAULT_OPENAI_BASE_URL = "http://127.0.0.1:1234/v1"
DEFAULT_OPENAI_API_KEY = "sk-1234"
DEFAULT_OPENAI_MODEL = "qwen35moe"

DEFAULT_MAX_TOKENS = 8192
DEFAULT_THINKING_TEMPERATURE = 1.0
DEFAULT_THINKING_PRESENCE_PENALTY = 0.0
DEFAULT_THINKING_TOP_P = 0.95
DEFAULT_THINKING_MIN_P = 0.0
DEFAULT_INSTRUCT_TEMPERATURE = 0.7
DEFAULT_INSTRUCT_PRESENCE_PENALTY = 1.5
DEFAULT_INSTRUCT_TOP_P = 0.8
DEFAULT_INSTRUCT_MIN_P = 0.0
DEFAULT_TOP_K = 20

# 1.0 disables the repetition penalty, so it is both the default and the value
# at which the key is left out of ``extra_body`` entirely.
NEUTRAL_REPEAT_PENALTY = 1.0
DEFAULT_THINKING_REPEAT_PENALTY = NEUTRAL_REPEAT_PENALTY
DEFAULT_INSTRUCT_REPEAT_PENALTY = NEUTRAL_REPEAT_PENALTY


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


def get_thinking_temperature() -> float:
    return _env_float("OPENAI_THINKING_TEMPERATURE", DEFAULT_THINKING_TEMPERATURE)


def get_thinking_presence_penalty() -> float:
    return _env_float("OPENAI_THINKING_PRESENCE_PENALTY", DEFAULT_THINKING_PRESENCE_PENALTY)


def get_thinking_top_p() -> float:
    return _env_float("OPENAI_THINKING_TOP_P", DEFAULT_THINKING_TOP_P)


def get_thinking_min_p() -> float:
    return _env_float("OPENAI_THINKING_MIN_P", DEFAULT_THINKING_MIN_P)


def get_instruct_temperature() -> float:
    return _env_float("OPENAI_INSTRUCT_TEMPERATURE", DEFAULT_INSTRUCT_TEMPERATURE)


def get_instruct_presence_penalty() -> float:
    return _env_float("OPENAI_INSTRUCT_PRESENCE_PENALTY", DEFAULT_INSTRUCT_PRESENCE_PENALTY)


def get_instruct_top_p() -> float:
    return _env_float("OPENAI_INSTRUCT_TOP_P", DEFAULT_INSTRUCT_TOP_P)


def get_instruct_min_p() -> float:
    return _env_float("OPENAI_INSTRUCT_MIN_P", DEFAULT_INSTRUCT_MIN_P)


def get_thinking_repeat_penalty() -> float:
    return _env_float("OPENAI_THINKING_REPEAT_PENALTY", DEFAULT_THINKING_REPEAT_PENALTY)


def get_instruct_repeat_penalty() -> float:
    return _env_float("OPENAI_INSTRUCT_REPEAT_PENALTY", DEFAULT_INSTRUCT_REPEAT_PENALTY)


def get_top_k() -> int:
    return _env_int("OPENAI_TOP_K", DEFAULT_TOP_K)


def build_sampling_extra_body(mode: str) -> dict[str, object]:
    """Sampling knobs local servers accept outside the OpenAI chat schema.

    ``repeat_penalty`` is the llama.cpp / LM Studio name for the knob Hugging
    Face and vLLM call ``repetition_penalty``. It is only sent once configured
    away from its neutral 1.0, so servers that do not recognise the key keep
    seeing exactly the request they saw before the setting existed.
    """
    instruct = mode == "instruct"
    repeat_penalty = get_instruct_repeat_penalty() if instruct else get_thinking_repeat_penalty()

    extra: dict[str, object] = {
        "top_k": get_top_k(),
        "min_p": get_instruct_min_p() if instruct else get_thinking_min_p(),
    }
    if repeat_penalty != NEUTRAL_REPEAT_PENALTY:
        extra["repeat_penalty"] = repeat_penalty
    if instruct:
        extra["chat_template_kwargs"] = {"enable_thinking": False}

    return extra


def create_openai_client() -> Any:
    """Return an OpenAI client configured from environment / defaults."""
    from openai import OpenAI

    return OpenAI(
        base_url=get_openai_base_url(),
        api_key=get_openai_api_key(),
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
