"""Shared vision-model plumbing for the auto-caption and verify-captions jobs.

Covers everything both jobs do identically: preparing images for the OpenAI
chat API, issuing the completion with the right sampling profile for the mode,
and retrying a flaky model. What each job asks the model for, and how it
interprets the answer, stays in the job module.
"""

from __future__ import annotations

import base64
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Generic, TypeVar

from PIL import Image

from openai_settings import (
    assistant_message_text,
    build_sampling_extra_body,
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

T = TypeVar("T")


def resize_for_qwen(image: Image.Image, max_pixels: int) -> Image.Image:
    """Downscale to ``max_pixels``, keeping both sides on Qwen's 32-pixel patch grid."""
    width, height = image.size
    current_pixels = width * height
    if current_pixels <= max_pixels:
        return image

    scale = (max_pixels / current_pixels) ** 0.5
    new_width = max((int(width * scale) // 32) * 32, 512)
    new_height = max((int(height * scale) // 32) * 32, 512)
    return image.resize((new_width, new_height), Image.Resampling.LANCZOS)


def image_to_base64(image: Image.Image) -> str:
    buffered = BytesIO()
    image.save(buffered, format="JPEG", quality=85)
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def prepare_images_for_api(
    images: list[Image.Image],
    *,
    max_pixels: int,
) -> list[str] | None:
    encoded: list[str] = []
    for image in images:
        try:
            resized = resize_for_qwen(image.convert("RGB"), max_pixels=max_pixels)
            encoded.append(image_to_base64(resized))
        except Exception as exc:
            logger.error("Image prepare error: %s", exc)
            return None
    return encoded


def load_image_rgb(media_path: Path) -> tuple[list[Image.Image] | None, str | None]:
    """Open a single image as a one-frame list, or report why it could not be read.

    Closing the source is deliberate rather than left to the garbage collector.
    Pillow drops the file handle inside ``load()`` only for single-frame formats;
    a multi-frame one holds it open for the lifetime of the image so later frames
    stay seekable, and both variants reach us under the supported extensions (an
    MPO ``.jpg``, an APNG ``.png``). On Windows that open handle locks the file,
    which is what stops the media from being moved, deleted or edited while the
    job is still running - or after it, whenever anything still references the
    image. ``convert`` returns a fully loaded copy, so it outlives the handle.
    """
    try:
        with Image.open(media_path) as image:
            return [image.convert("RGB")], None
    except Exception as exc:
        logger.error("Image read error for %s: %s", media_path.name, exc)
        return None, str(exc)


def vision_messages(system_prompt: str, images_b64: list[str], user_text: str) -> list[dict]:
    content: list[dict] = [
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
        }
        for encoded in images_b64
    ]
    content.append({"type": "text", "text": user_text})
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


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


def run_vision_completion(
    client,
    messages: list[dict],
    *,
    mode: str,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str | None:
    """Send a vision chat completion, returning the assistant text or ``None`` on failure."""
    profile = get_sampling_profile(mode)
    outbound = messages
    if mode == "instruct":
        # Empty-think prefill skips reasoning on hybrid Qwen models; kwargs for servers
        # that honor them (vLLM, some LM Studio builds). Prefill helps when kwargs are ignored.
        outbound = [*messages, {"role": "assistant", "content": INSTRUCT_THINK_PREFILL}]

    try:
        response = client.chat.completions.create(
            model=model if model is not None else get_openai_model(),
            messages=outbound,
            max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
            temperature=profile.temperature,
            top_p=profile.top_p,
            presence_penalty=profile.presence_penalty,
            extra_body=build_sampling_extra_body(mode),
        )
        raw = assistant_message_text(
            response.choices[0].message,
            allow_reasoning_fallback=mode == "instruct",
        )
        return raw or None
    except Exception as exc:
        logger.error("API/Vision error: %s", exc)
        return None


@dataclass(frozen=True)
class ModelOutcome(Generic[T]):
    """One model attempt. ``status`` is ``SUCCESS`` when ``value`` is usable.

    A failed attempt may still carry a ``value`` so callers can report what the
    model kept producing (e.g. a caption that came back too short every time).
    """

    status: str
    value: T | None = None
    message: str | None = None


def close_vision_client(client: object) -> None:
    """Best-effort teardown so an abandoned request stops occupying the model server.

    Only called once a job has been cancelled, after which its client is never used again.
    """
    close = getattr(client, "close", None)
    if close is None:
        return

    try:
        close()
    except Exception as exc:
        logger.debug("Closing the vision client after cancellation failed: %s", exc)


def _await_attempt(
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

    worker = threading.Thread(target=run, name="vision-model-call", daemon=True)
    worker.start()

    while worker.is_alive():
        worker.join(CANCEL_POLL_SECONDS)
        if worker.is_alive() and should_cancel():
            return None

    if failures:
        raise failures[0]

    return outcomes[0]


def call_with_retries(
    attempt: Callable[[], ModelOutcome[T]],
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
    """
    outcome: ModelOutcome[T] = ModelOutcome(status=API_ERROR)

    for number in range(1, attempts + 1):
        if should_cancel and should_cancel():
            return ModelOutcome(status=CANCELLED)

        if should_cancel is None:
            outcome = attempt()
        else:
            awaited = _await_attempt(attempt, should_cancel)
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
