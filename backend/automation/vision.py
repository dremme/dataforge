"""Shared vision-model plumbing for the auto-caption and verify-captions jobs.

Covers everything both jobs do identically: classifying image vs motion media,
extracting video/GIF keyframes, owning the model client for a run, assembling and
issuing the request with the right sampling profile for the mode, and retrying a
flaky model. What each job asks the model for, and how it interprets the answer,
stays in the job module.
"""

from __future__ import annotations

import base64
import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

from PIL import Image

from constants import GIF_EXTENSION, MOTION_EXTENSIONS
from gif_frames import extract_gif_keyframes, keyframe_indices
from openai_settings import (
    assistant_message_text,
    build_sampling_extra_body,
    create_openai_client,
    get_max_tokens,
    get_openai_model,
    get_sampling_profile,
)

logger = logging.getLogger(__name__)

MAX_MODEL_ATTEMPTS = 3

# Evenly spaced samples across a motion file; short GIFs yield fewer than this.
VIDEO_KEYFRAME_COUNT = 12
# How far back to hunt for a closing frame when the reported frame count overshoots
# the decodable tail. Metadata is wrong by a handful of frames, not by seconds, so a
# longer walk means the file is broken rather than merely mis-measured.
TAIL_SEEK_LIMIT = 32
# Multi-frame payloads stay smaller than stills so the request remains tractable.
VIDEO_FRAME_MAX_PIXELS = 500_000

MediaKind = Literal["image", "video"]

# How often a waiting job re-checks for cancellation while the model request is in flight.
CANCEL_POLL_SECONDS = 0.1

# Used as a trailing assistant prefill for "instruct" (non-thinking) mode on Qwen3 hybrid models.
# Signals that any thinking phase is complete/empty so the model emits the final answer directly.
INSTRUCT_THINK_PREFILL = "<think>\n\n</think>"

SUCCESS = "success"
API_ERROR = "api_error"
CANCELLED = "cancelled"
# A still that would not decode, and a motion file that yielded no keyframes. Both
# jobs count these under the same names, which is also what the UI reads them by.
READ_ERROR = "read_error"
FRAME_ERROR = "frame_error"

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


def media_kind_for(path: Path) -> MediaKind:
    """How a file is captioned or verified, which for a GIF is as a video.

    ``MediaKind`` is the training axis, and a GIF carries a frame sequence, so it
    gets the video prompt and the keyframe pipeline. ``schemas.MediaType`` is the
    rendering axis and calls the same file a ``gif``.
    """
    return "video" if path.suffix.lower() in MOTION_EXTENSIONS else "image"


def _read_frame_at(cap, cv2, frame_index: int) -> Image.Image | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if not ok:
        return None
    return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))


def _seek_keyframes(cap, cv2, total_frames: int, count: int) -> list[Image.Image]:
    """Sample a video whose length is known, ending on its real last frame."""
    wanted = keyframe_indices(total_frames, count)
    captured = {index: image for index in wanted if (image := _read_frame_at(cap, cv2, index))}

    last_wanted = wanted[-1] if wanted else 0
    if wanted and last_wanted not in captured:
        # CAP_PROP_FRAME_COUNT is duration x fps, which overshoots the real
        # decodable tail often enough that the closing frame would otherwise be
        # dropped in silence. Walk back to the last index that does read.
        floor = max(captured, default=-1)
        limit = max(floor, last_wanted - TAIL_SEEK_LIMIT)
        for index in range(last_wanted - 1, limit, -1):
            image = _read_frame_at(cap, cv2, index)
            if image is not None:
                captured[index] = image
                break

    return [captured[index] for index in sorted(captured)]


def _streamed_keyframes(cap, cv2, count: int) -> list[Image.Image]:
    """Sample a video whose length is unknown, ending on its real last frame.

    A container that reports no frame count cannot be seeked either, so the end is
    only discoverable by decoding to it. Kept frames are halved whenever they
    outgrow ``2 * count``, which bounds what is held in memory while preserving the
    opening frame and an even spread; the newest frame is tracked separately so the
    closing one survives regardless of where the halving left the stride.
    """
    kept: list[Image.Image] = []
    last: Image.Image | None = None
    stride = 1
    position = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        last = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        if position % stride == 0:
            kept.append(last)
            if len(kept) > 2 * count:
                # Every second frame, so the survivors are still evenly spaced and
                # still start at position 0.
                kept = kept[::2]
                stride *= 2
        position += 1

    if last is None:
        return []
    if kept[-1] is not last:
        kept.append(last)

    return [kept[index] for index in keyframe_indices(len(kept), count)]


def extract_video_keyframes(
    video_path: Path,
    count: int = VIDEO_KEYFRAME_COUNT,
) -> list[Image.Image] | None:
    """Evenly spaced frames spanning the whole clip, first and last included."""
    import cv2

    # release() covers the failed-open branch too: a capture that never opened still
    # holds the file on Windows, which locks the video against moves and deletes.
    cap = cv2.VideoCapture(str(video_path))
    try:
        if not cap.isOpened():
            logger.error("Failed to open video for keyframe extraction: %s", video_path.name)
            return None

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        if total_frames <= 0:
            return _streamed_keyframes(cap, cv2, count) or None

        return _seek_keyframes(cap, cv2, total_frames, count) or None
    finally:
        cap.release()


def extract_keyframes(
    media_path: Path, count: int = VIDEO_KEYFRAME_COUNT
) -> list[Image.Image] | None:
    """Evenly spaced frames, decoded by whichever reader handles the container.

    GIFs never reach OpenCV: it reports a frame count of zero for many of them,
    which silently drops ``extract_video_keyframes`` into its sequential fallback
    and captions only the opening of the animation.
    """
    if media_path.suffix.lower() == GIF_EXTENSION:
        return extract_gif_keyframes(media_path, count)
    return extract_video_keyframes(media_path, count)


def keyframe_sentence(frame_count: int) -> str:
    """States the real frame count, which a short GIF makes smaller than the cap."""
    if frame_count == 1:
        return "You are given a single frame. Analyze it while following the system instructions."
    return (
        f"You are given {frame_count} keyframes in chronological order. "
        "Analyze the full video sequence while following the system instructions."
    )


@dataclass(frozen=True)
class MediaLoadError:
    """Why a file never reached the model.

    ``status`` is the job counter it lands in, and is deliberately the exact stat key
    rather than something a caller has to translate: the same string travels through
    the job stats and out to the UI. ``message`` is the reader's own explanation, which
    only a still can supply - a failed keyframe extraction logs its reason and leaves
    the user the count.
    """

    status: str
    message: str | None = None


def load_media_images(
    media_path: Path,
) -> tuple[list[Image.Image] | None, MediaLoadError | None]:
    """Load stills or motion keyframes for a vision request.

    Returns ``(frames, None)`` on success, or ``(None, error)`` describing why not.
    """
    if media_kind_for(media_path) == "video":
        keyframes = extract_keyframes(media_path)
        if not keyframes:
            return None, MediaLoadError(FRAME_ERROR)
        return keyframes, None

    images, error = load_image_rgb(media_path)
    if images is None:
        return None, MediaLoadError(READ_ERROR, error)
    return images, None


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


def request_vision_text(
    client,
    system_prompt: str,
    images: list[Image.Image],
    user_text: str,
    *,
    max_pixels: int,
    mode: str,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str | None:
    """Encode ``images`` and ask the model, returning the assistant text or ``None``.

    Both jobs assemble a request identically; only the pixel budget and the user text
    differ, so those arrive already resolved for the file's media kind.
    """
    images_b64 = prepare_images_for_api(images, max_pixels=max_pixels)
    if not images_b64:
        return None

    return run_vision_completion(
        client,
        vision_messages(system_prompt, images_b64, user_text),
        mode=mode,
        model=model,
        max_tokens=max_tokens,
    )


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
class ModelOutcome[T]:
    """One model attempt. ``status`` is ``SUCCESS`` when ``value`` is usable.

    A failed attempt may still carry a ``value`` so callers can report what the
    model kept producing (e.g. a caption that came back too short every time).
    """

    status: str
    value: T | None = None
    message: str | None = None


def close_vision_client(client: object) -> None:
    """Best-effort teardown of a client that will not be used again.

    Safe to call twice: a cancelled job closes the client the moment it abandons an
    in-flight request, and ``vision_client`` closes it again when the run unwinds.
    """
    close = getattr(client, "close", None)
    if close is None:
        return

    try:
        close()
    except Exception as exc:
        logger.debug("Closing the vision client failed: %s", exc)


@contextmanager
def vision_client() -> Iterator[Any]:
    """A model client scoped to one job run.

    The client owns a connection pool, so a run that walked away from it would leave
    that pool alive until the process collected it - one per run, on a server that
    stays up across many.
    """
    client = create_openai_client()
    try:
        yield client
    finally:
        close_vision_client(client)


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

    worker = threading.Thread(target=run, name="vision-model-call", daemon=True)
    worker.start()

    while worker.is_alive():
        worker.join(CANCEL_POLL_SECONDS)
        if worker.is_alive() and should_cancel():
            return None

    if failures:
        raise failures[0]

    return outcomes[0]


def call_with_retries[T](
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
