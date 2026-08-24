"""Local-model plumbing shared by every job that talks to the LLM.

Owning the client for a run, issuing a chat completion with the right sampling
profile for the mode, cleaning the reply, explaining a request that came back
empty, and retrying a flaky model — none of which knows anything about images.
What a job asks for, and how it reads the answer, stays in the job module.

``vision.py`` builds on this to send media; ``edit_captions.py`` uses it directly
with nothing but text. The split is the point: a text-only job has no business
importing a vision module.
"""

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

# How often a waiting job re-checks for cancellation while the model request is in flight.
CANCEL_POLL_SECONDS = 0.1

# Used as a trailing assistant prefill for "instruct" (non-thinking) mode on Qwen3 hybrid models.
# Signals that any thinking phase is complete/empty so the model emits the final answer directly.
INSTRUCT_THINK_PREFILL = "<think>\n\n</think>"

SUCCESS = "success"
API_ERROR = "api_error"
CANCELLED = "cancelled"

# Openers the model reaches for when told to answer with the bare thing. The two
# media-flavoured ones are here rather than in ``vision`` because they are only
# strings to strip: a text-only job that somehow gets one still wants it gone.
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
    """Drop a wrapping ``` block, whatever language tag it carries.

    Shared by every job that asks for a bare answer and gets a fenced one, which is
    the most common way this model dresses up a reply it was told not to dress up.
    """
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
    """The exception's own words plus the chain that actually explains it.

    ``str(exc)`` is frequently the least informative part: the OpenAI SDK reports
    every transport failure as ``APIConnectionError("Connection error.")`` and
    leaves the socket error that caused it - a reset, a half-closed connection, a
    server that died mid-upload - reachable only through ``__cause__``. Logging the
    bare string is what turned a wedged model server into an unexplained
    ``api_error``, so the causes are walked and the HTTP status and body of a
    status error are pulled in alongside.
    """
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
    """Why a request that the server answered normally carried no text.

    This is the failure that reports nothing anywhere: the server returns 200, the
    choice says it stopped of its own accord, ``completion_tokens`` is 0, and the
    content is an empty string - so the model server logs a served request, the SDK
    raises nothing, and the job used to record a bare ``api_error``. Everything the
    response does carry is worth having, because which field looks wrong is what
    separates the causes: a ``length`` finish means the generation budget ran out,
    a ``prompt_tokens`` well below what the same request reports on its own means the
    server reused a prompt prefix that did not belong to it, and content that is
    empty while ``reasoning_content`` is not means the model spent the whole budget
    thinking.
    """
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
    """Send a chat completion, returning the assistant text or ``None`` on failure.

    ``messages`` is passed through untouched, so a caller sends whatever content
    shape it needs: a media parts list from ``vision.vision_messages``, or a plain
    string for a text-only job.

    Both ways of coming back empty are logged before ``None`` is returned. Neither
    used to be: an exception was reduced to ``str(exc)``, and a well-formed response
    that simply contained no text was returned as ``None`` in complete silence, which
    is the whole reason a failed video looked like nothing had happened at all.
    """
    profile = get_sampling_profile(mode)
    resolved_model = model if model is not None else get_openai_model()
    outbound = messages
    if mode == "instruct":
        # Empty-think prefill skips reasoning on hybrid Qwen models; kwargs for servers
        # that honor them (vLLM, some LM Studio builds). Prefill helps when kwargs are ignored.
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
    """One model attempt. ``status`` is ``SUCCESS`` when ``value`` is usable.

    A failed attempt may still carry a ``value`` so callers can report what the
    model kept producing (e.g. a caption that came back too short every time).
    """

    status: str
    value: T | None = None
    message: str | None = None


def close_model_client(client: object) -> None:
    """Best-effort teardown of a client that will not be used again.

    Safe to call twice: a cancelled job closes the client the moment it abandons an
    in-flight request, and ``model_client`` closes it again when the run unwinds.
    """
    close = getattr(client, "close", None)
    if close is None:
        return

    try:
        close()
    except Exception as exc:
        logger.debug("Closing the model client failed: %s", exc)


@contextmanager
def model_client() -> Iterator[Any]:
    """A model client scoped to one job run.

    The client owns a connection pool, so a run that walked away from it would leave
    that pool alive until the process collected it - one per run, on a server that
    stays up across many.
    """
    client = create_openai_client()
    try:
        yield client
    finally:
        close_model_client(client)


def _await_attempt[T](
    attempt: Callable[[], ModelOutcome[T]],
    should_cancel: Callable[[], bool],
) -> ModelOutcome[T] | None:
    """Run ``attempt`` on a helper thread, returning ``None`` when cancellation wins the race.

    A model request blocks in a socket read that cannot be interrupted, so a cancelled job
    stops waiting for it rather than holding the whole job hostage until the server answers.
    The abandoned thread ends on its own once the request completes or hits its timeout, and
    its result is discarded: every file write happens after this returns, never inside it.
    """
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
    """Run ``attempt`` until it succeeds, the attempts run out, or the job is cancelled.

    The last failing outcome is returned once the attempts are exhausted. ``on_abandon``
    runs when cancellation drops a request that is still in flight.

    ``attempt`` is handed its own 1-based number, which is how a retry can tell it is
    one and send something other than the payload that just failed - see
    ``vision.retry_jpeg_quality``. A text-only job has no such payload and ignores it.
    """
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
