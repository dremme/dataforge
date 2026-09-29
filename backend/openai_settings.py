"""Shared OpenAI-compatible vision LLM settings. Reasoning effort is a per-job choice, not an env var."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app_settings import NO_API_KEY, SETTING_DEFAULTS, effective_settings
from env_file import env_str

DEFAULT_OPENAI_API_KEY = NO_API_KEY

DEFAULT_MAX_TOKENS = SETTING_DEFAULTS.vision_max_tokens
DEFAULT_TOP_K = SETTING_DEFAULTS.vision_top_k

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


def _profile(settings: object, mode: str) -> SamplingProfile:
    return SamplingProfile(
        temperature=getattr(settings, f"{mode}_temperature"),
        presence_penalty=getattr(settings, f"{mode}_presence_penalty"),
        top_p=getattr(settings, f"{mode}_top_p"),
        min_p=getattr(settings, f"{mode}_min_p"),
        repeat_penalty=getattr(settings, f"{mode}_repeat_penalty"),
    )


THINKING_DEFAULTS = _profile(SETTING_DEFAULTS, "thinking")
INSTRUCT_DEFAULTS = _profile(SETTING_DEFAULTS, "instruct")


def _env_float(name: str, default: float) -> float:
    raw = env_str(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def get_openai_base_url() -> str:
    return effective_settings().vision_base_url


def get_openai_api_key() -> str:
    return effective_settings().vision_api_key


def get_openai_model() -> str:
    return effective_settings().vision_model


def get_max_tokens() -> int:
    return effective_settings().vision_max_tokens


def get_top_k() -> int:
    return effective_settings().vision_top_k


def get_openai_timeout() -> float:
    timeout = _env_float("OPENAI_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)
    return timeout if timeout > 0 else DEFAULT_TIMEOUT_SECONDS


def get_sampling_profile(mode: str) -> SamplingProfile:
    return _profile(effective_settings(), "instruct" if mode == "instruct" else "thinking")


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
