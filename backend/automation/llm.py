"""Local-model plumbing shared by every job that talks to the LLM."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from functools import partial
from typing import Any

from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    assistant_message_text,
    build_sampling_extra_body,
    create_openai_client,
    get_max_tokens,
    get_openai_model,
    get_sampling_profile,
)

logger = logging.getLogger(__name__)

MAX_MODEL_ATTEMPTS = 3

CANCEL_POLL_SECONDS = 0.1

# Instruct-mode prefill so hybrid Qwen models skip thinking and emit the answer.
INSTRUCT_THINK_PREFILL = "<think>\n\n</think>"

SUCCESS = "success"
API_ERROR = "api_error"
CANCELLED = "cancelled"

# Includes media-flavoured openers so a text-only job still strips them.
_STRIPPED_PREFIXES = (
    "assistant:",
    "Here is the caption:",
    "Caption:",
    "The image shows:",
    "The video shows:",
    "The caption is:",
    "Revised caption:",
    "Output:",
)


def strip_code_fences(text: str) -> str:
    """Drop a wrapping ``` block, whatever language tag it carries."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped

    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def clean_model_text(raw_text: str) -> str:
    """Strip reasoning blocks, chat template markers and conversational prefixes."""
    text = raw_text.strip()

    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
    if "<think>" in text:
        text = text.split("<think>")[0].strip()

    text_lower = text.lower()
    for prefix in _STRIPPED_PREFIXES:
        if text_lower.startswith(prefix.lower()):
            text = text[len(prefix) :].strip()
            break

    return text.replace("<|im_end|>", "").replace("<|endoftext|>", "").strip()


def _field(source: object, name: str) -> object:
    """Read ``name`` off a response object or the dict a stub stands in for it with."""
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def describe_exception(exc: BaseException) -> str:
    """The exception's own words plus the ``__cause__`` chain that actually explains it."""
    parts: list[str] = []
    current: BaseException | None = exc
    while current is not None and len(parts) < 4:
        detail = f"{type(current).__name__}: {current}".strip()
        status = _field(current, "status_code")
        if status is not None:
            detail = f"{detail} [HTTP {status}]"
        body = _field(current, "body")
        if body:
            detail = f"{detail} body={repr(body)[:300]}"
        parts.append(detail)
        current = current.__cause__ or current.__context__

    return " <- ".join(parts)


def describe_empty_completion(response: object) -> str:
    """Why a 200 response carried no usable assistant text."""
    choices = _field(response, "choices") or []
    if not choices:
        return "the response carried no choices"

    choice = choices[0]
    message = _field(choice, "message")
    usage = _field(response, "usage")
    content = _field(message, "content") if message is not None else None
    reasoning = _field(message, "reasoning_content") if message is not None else None

    details = [
        f"finish_reason={_field(choice, 'finish_reason')}",
        f"prompt_tokens={_field(usage, 'prompt_tokens') if usage is not None else None}",
        f"completion_tokens={_field(usage, 'completion_tokens') if usage is not None else None}",
        f"content_chars={len(content) if isinstance(content, str) else 0}",
        f"reasoning_chars={len(reasoning) if isinstance(reasoning, str) else 0}",
    ]
    return ", ".join(details)


def run_chat_completion(
    client,
    messages: list[dict],
    *,
    mode: str,
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str | None:
    profile = get_sampling_profile(mode)
    resolved_model = model if model is not None else get_openai_model()
    outbound = messages
    if mode == "instruct":
        # Prefill skips thinking on hybrid Qwen; helps when extra_body kwargs are ignored.
        outbound = [*messages, {"role": "assistant", "content": INSTRUCT_THINK_PREFILL}]

    try:
        response = client.chat.completions.create(
            model=resolved_model,
            messages=outbound,
            max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
            temperature=profile.temperature,
            top_p=profile.top_p,
            presence_penalty=profile.presence_penalty,
            extra_body=build_sampling_extra_body(
                mode,
                effort=effort,
                preserve_thinking=preserve_thinking,
            ),
        )
    except Exception as exc:
        logger.error("Model request to %s failed: %s", resolved_model, describe_exception(exc))
        return None

    choices = _field(response, "choices") or []
    raw = (
        assistant_message_text(
            _field(choices[0], "message"),
            allow_reasoning_fallback=mode == "instruct",
        )
        if choices
        else ""
    )
    if not raw:
        logger.error(
            "Model request to %s returned no usable text (%s)",
            resolved_model,
            describe_empty_completion(response),
        )
        return None

    return raw


@dataclass(frozen=True)
class ModelOutcome[T]:
    """One attempt; failed outcomes may still carry ``value`` for reporting."""

    status: str
    value: T | None = None
    message: str | None = None


def close_model_client(client: object) -> None:
    """Best-effort teardown; safe to call twice."""
    close = getattr(client, "close", None)
    if close is None:
        return

    try:
        close()
    except Exception as exc:
        logger.debug("Closing the model client failed: %s", exc)


@contextmanager
def model_client() -> Iterator[Any]:
    """A model client scoped to one job run."""
    client = create_openai_client()
    try:
        yield client
    finally:
        close_model_client(client)


def _await_attempt[T](
    attempt: Callable[[], ModelOutcome[T]],
    should_cancel: Callable[[], bool],
) -> ModelOutcome[T] | None:
    """Run ``attempt`` on a helper thread; ``None`` if cancellation wins the uninterruptible socket wait."""
    outcomes: list[ModelOutcome[T]] = []
    failures: list[Exception] = []

    def run() -> None:
        try:
            outcomes.append(attempt())
        except Exception as exc:
            failures.append(exc)

    worker = threading.Thread(target=run, name="llm-model-call", daemon=True)
    worker.start()

    while worker.is_alive():
        worker.join(CANCEL_POLL_SECONDS)
        if worker.is_alive() and should_cancel():
            return None

    if failures:
        raise failures[0]

    return outcomes[0]


def call_with_retries[T](
    attempt: Callable[[int], ModelOutcome[T]],
    *,
    job_label: str,
    media_name: str,
    should_cancel: Callable[[], bool] | None = None,
    on_abandon: Callable[[], None] | None = None,
    attempts: int = MAX_MODEL_ATTEMPTS,
) -> ModelOutcome[T]:
    """Retry ``attempt`` until success, exhaustion, or cancel; ``on_abandon`` runs if an in-flight request is dropped."""
    outcome: ModelOutcome[T] = ModelOutcome(status=API_ERROR)

    for number in range(1, attempts + 1):
        if should_cancel and should_cancel():
            return ModelOutcome(status=CANCELLED)

        this_attempt = partial(attempt, number)
        if should_cancel is None:
            outcome = this_attempt()
        else:
            awaited = _await_attempt(this_attempt, should_cancel)
            if awaited is None:
                logger.info(
                    "%s cancelled while waiting on the model for %s; dropping the request",
                    job_label,
                    media_name,
                )
                if on_abandon:
                    on_abandon()
                return ModelOutcome(status=CANCELLED)
            outcome = awaited

        if should_cancel and should_cancel():
            return ModelOutcome(status=CANCELLED)
        if outcome.status == SUCCESS:
            return outcome

        if number < attempts:
            logger.warning(
                "%s attempt %s/%s failed for %s (%s); retrying",
                job_label,
                number,
                attempts,
                media_name,
                outcome.status,
            )

    return outcome
