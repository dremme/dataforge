"""Shared vision-model plumbing for the auto-caption and verify-captions jobs.

Covers everything both jobs do identically: classifying image vs video media,
extracting video keyframes, reading a GIF's opening frame, owning the model client
for a run, assembling and issuing the request with the right sampling profile for
the mode, and retrying a flaky model. What each job asks the model for, and how it
interprets the answer, stays in the job module.
"""

from __future__ import annotations

import base64
import logging
import math
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

from PIL import Image

from automation.audio import AUDIO_FORMAT
from constants import GIF_EXTENSION, VIDEO_EXTENSIONS
from gif_frames import extract_gif_first_frame, keyframe_indices
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    assistant_message_text,
    build_sampling_extra_body,
    create_openai_client,
    get_max_tokens,
    get_openai_model,
    get_sampling_profile,
    positive_env_int,
)

logger = logging.getLogger(__name__)

MAX_MODEL_ATTEMPTS = 3

# Evenly spaced samples across a video, in two roles: the floor below which a short
# clip is not sampled any thinner than it used to be, and the fallback for a
# container that will not say how fast it runs. Short clips yield fewer than this.
VIDEO_KEYFRAME_COUNT = 12
# A video is sampled by its length instead, twice a second plus both endpoints, since
# a dozen frames across a long clip describes motion the model never saw.
KEYFRAMES_PER_SECOND = 2
# Where that stops. Every frame is inlined in one request at roughly 640 vision
# tokens, so an uncapped count would build a payload no model accepts - and
# ``call_with_retries`` would upload it three times before saying so.
MAX_VIDEO_KEYFRAME_COUNT = 64
# Above this a reported frame rate is metadata corruption rather than a fast camera:
# the usual culprit is a container reporting its MPEG timescale of 90000. Real
# high-speed footage tops out well below it.
MAX_PLAUSIBLE_FPS = 1000.0
# How far back to hunt for a closing frame when the reported frame count overshoots
# the decodable tail. Metadata is wrong by a handful of frames, not by seconds, so a
# longer walk means the file is broken rather than merely mis-measured.
TAIL_SEEK_LIMIT = 32
# Neither side is scaled below this, whatever the pixel budget says.
QWEN_MIN_SIDE_PX = 512
# Under this both sides floor and every frame comes out square; between here and roughly
# 500k only one floors, so the frame is not smaller, it is the wrong shape.
MIN_HONORED_MAX_PIXELS = QWEN_MIN_SIDE_PX * QWEN_MIN_SIDE_PX

# Multi-frame payloads stay smaller than stills so the request remains tractable. Near
# the bottom of the useful range: frames cannot be bought by shrinking them.
VIDEO_FRAME_MAX_PIXELS = 500_000
# A still is the only image in its request, so it can afford detail a keyframe sent
# sixty at a time cannot - and fact-checking one often turns on a small part of the
# frame. Both caption jobs share this budget.
IMAGE_MAX_PIXELS = 1_500_000

# The four values above are defaults. The cap is what makes a brief action vanish from a
# long clip - 64 frames over two minutes is 0.5 fps - so each is env-configurable to make
# that measurable. Read per call, not at import.
KEYFRAMES_PER_SECOND_VAR = "VIDEO_KEYFRAMES_PER_SECOND"
MAX_VIDEO_KEYFRAMES_VAR = "VIDEO_MAX_KEYFRAMES"
VIDEO_FRAME_MAX_PIXELS_VAR = "VIDEO_FRAME_MAX_PIXELS"
IMAGE_MAX_PIXELS_VAR = "IMAGE_MAX_PIXELS"


def get_keyframes_per_second() -> int:
    return positive_env_int(KEYFRAMES_PER_SECOND_VAR, KEYFRAMES_PER_SECOND)


def get_max_video_keyframes() -> int:
    return positive_env_int(MAX_VIDEO_KEYFRAMES_VAR, MAX_VIDEO_KEYFRAME_COUNT)


def get_video_frame_max_pixels() -> int:
    return positive_env_int(VIDEO_FRAME_MAX_PIXELS_VAR, VIDEO_FRAME_MAX_PIXELS)


def get_image_max_pixels() -> int:
    return positive_env_int(IMAGE_MAX_PIXELS_VAR, IMAGE_MAX_PIXELS)


MediaKind = Literal["image", "video"]


def media_kind_max_pixels(media_kind: MediaKind) -> int:
    """Per-frame pixel budget. Stills get the larger one; keyframes are sent dozens at a time.

    A function rather than the dict this was: a module-level dict resolves both
    configurable budgets once at import, so a set value never reaches a frame.
    """
    return get_image_max_pixels() if media_kind == "image" else get_video_frame_max_pixels()


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
    """Downscale to ``max_pixels``, keeping both sides on Qwen's 32-pixel patch grid.

    The floor applies to each side on its own, so below ``MIN_HONORED_MAX_PIXELS`` a
    frame stops shrinking and changes shape: a 16:9 frame is 640x512 at a 250k budget.
    """
    width, height = image.size
    current_pixels = width * height
    if current_pixels <= max_pixels:
        return image

    scale = (max_pixels / current_pixels) ** 0.5
    new_width = max((int(width * scale) // 32) * 32, QWEN_MIN_SIDE_PX)
    new_height = max((int(height * scale) // 32) * 32, QWEN_MIN_SIDE_PX)
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
    """How a file is captioned or verified, which for a GIF is as an image.

    A GIF carries a frame sequence, but the model is shown its opening frame and
    told it is looking at a still: the animation is rarely what the caption is
    about, and sampling it into keyframes spent a dozen images saying so. The
    gallery is unaffected - it still animates the file and still scrubs its frames,
    and ``schemas.MediaType`` still calls it a ``gif``.
    """
    return "video" if path.suffix.lower() in VIDEO_EXTENSIONS else "image"


@dataclass(frozen=True)
class MediaFrames:
    """What one file contributes to a request: the frames, and when each was taken.

    ``timestamps`` is ``None`` whenever the source will not say - a video whose
    container reports no usable frame rate, one sampled by streaming because it
    reports no frame count, a GIF carrying no delays, or a still, which has no
    timeline at all. It is otherwise one entry per frame, in seconds from the start,
    and exactly as long as ``images``: the request labels frames by pairing the two.
    """

    images: list[Image.Image]
    timestamps: list[float] | None = None


def keyframe_count_for_seconds(seconds: float | None) -> int:
    """How many frames a clip of this length is worth sampling.

    Floored so a short clip is never sampled more thinly than it was before this
    existed, and capped so a long one cannot build a request no model will take. An
    unusable duration falls back to the fixed count.
    """
    if seconds is None or not math.isfinite(seconds) or seconds <= 0:
        return VIDEO_KEYFRAME_COUNT

    wanted = get_keyframes_per_second() * math.ceil(seconds) + 2
    return min(max(wanted, VIDEO_KEYFRAME_COUNT), get_max_video_keyframes())


def _video_fps(cap, cv2) -> float | None:
    """How fast the clip runs, or ``None`` when the container will not say usefully.

    The one measurement behind both the frame count and the frame timestamps, so a
    clip that will not report a usable rate loses both together rather than being
    sampled by a number the labels then contradict.
    """
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if not math.isfinite(fps) or fps <= 0 or fps > MAX_PLAUSIBLE_FPS:
        return None
    return fps


def _video_seconds(fps: float | None, total_frames: int) -> float | None:
    """How long the clip runs, given a rate ``_video_fps`` already vetted.

    Both ways of being wrong are safe: an overstated frame rate understates the
    length and lands on the floor, an understated one overstates it and lands on the
    cap. There is no lower bound beyond zero because a pathologically small rate is
    already bounded by the cap, and by ``keyframe_indices`` never returning more
    indices than the clip has frames.
    """
    return None if fps is None else total_frames / fps


def _capped(image: Image.Image) -> Image.Image:
    """A keyframe at the multi-frame budget, applied as it is read.

    A long clip's frames are held for the whole model call, retries included, so
    shrinking them only at request time would keep sixty-four full-resolution frames
    resident - gigabytes for 4K footage. Nothing is lost: this is the same budget
    ``prepare_images_for_api`` would apply before the frames left the process, and
    ``resize_for_qwen`` returns an already-small frame untouched. Both ends read the
    getter, or a configured budget would be applied here and again at a different size.
    """
    return resize_for_qwen(image, max_pixels=get_video_frame_max_pixels())


def _read_frame_at(cap, cv2, frame_index: int) -> Image.Image | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if not ok:
        return None
    return _capped(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))


def _seek_keyframes(cap, cv2, total_frames: int, count: int, fps: float | None) -> MediaFrames:
    """Sample a video whose length is known, ending on its real last frame.

    The frame indices are what make the timestamps exact rather than assumed even:
    the tail walk below can land on an index other than the one asked for, and a
    label derived from position in the list would then be wrong by that much.
    """
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

    indices = sorted(captured)
    return MediaFrames(
        images=[captured[index] for index in indices],
        timestamps=None if fps is None else [index / fps for index in indices],
    )


def _streamed_keyframes(cap, cv2, count: int) -> MediaFrames:
    """Sample a video whose length is unknown, ending on its real last frame.

    A container that reports no frame count cannot be seeked either, so the end is
    only discoverable by decoding to it. Kept frames are halved whenever they
    outgrow ``2 * count`` retained frames, which bounds what is held in memory while
    preserving the opening frame and an even spread; the newest frame is tracked
    separately so the closing one survives regardless of where the halving left the
    stride.

    Deliberately not sampled by duration like the seekable path: the length is only
    known once the decode finishes, but the frames have to be retained *during* it,
    so provisioning for the larger count would mean holding twice that many
    full-resolution frames to serve the rarest branch here.

    Timestamps are left out for the same reason the count is: the halving stride
    means a survivor's position in the list no longer maps to a position in the
    clip, so any label put on it would be a guess.
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
        return MediaFrames(images=[])
    if kept[-1] is not last:
        kept.append(last)

    return MediaFrames(
        images=[_capped(kept[index]) for index in keyframe_indices(len(kept), count)]
    )


def extract_video_keyframes(
    video_path: Path,
    count: int | None = None,
) -> MediaFrames | None:
    """Evenly spaced frames spanning the whole clip, first and last included.

    ``count`` of ``None`` derives one from the clip's length; an explicit count is
    taken as given. Frames come back capped at ``VIDEO_FRAME_MAX_PIXELS``, carrying
    their timestamps whenever the container reported a usable frame rate.
    """
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
            streamed = _streamed_keyframes(cap, cv2, count or VIDEO_KEYFRAME_COUNT)
            return streamed if streamed.images else None

        fps = _video_fps(cap, cv2)
        resolved = (
            count
            if count is not None
            else keyframe_count_for_seconds(_video_seconds(fps, total_frames))
        )
        seeked = _seek_keyframes(cap, cv2, total_frames, resolved, fps)
        return seeked if seeked.images else None
    finally:
        cap.release()


def keyframe_sentence(frame_count: int, seconds: float | None = None) -> str:
    """States the real frame count, which a short GIF shrinks and a long clip grows.

    ``seconds`` is the clip's span, and its absence reproduces the sentence exactly
    as it read before timestamps existed - which is what every unlabelled path
    still gets. When present it also accounts for the ``<n.n seconds>`` markers
    sitting between the frames, so they read as labels rather than stray tokens.
    """
    if frame_count == 1:
        return "You are given a single frame. Analyze it while following the system instructions."
    if seconds is None:
        return (
            f"You are given {frame_count} keyframes in chronological order. "
            "Analyze the full video sequence while following the system instructions."
        )
    return (
        f"You are given {frame_count} keyframes in chronological order, spanning "
        f"{seconds:.1f} seconds of video and each labelled with its timestamp. "
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
) -> tuple[MediaFrames | None, MediaLoadError | None]:
    """Load a video's keyframes or a single still for a vision request.

    Returns ``(frames, None)`` on success, or ``(None, error)`` describing why not.
    Only a video carries timestamps: one frame has no timeline to place it on.

    A GIF takes the still path but not ``load_image_rgb``, which would hand Pillow's
    uncomposited ``convert("RGB")`` to the model - see ``extract_gif_first_frame``.
    It keeps Pillow either way: OpenCV reports a frame count of zero for many GIFs.
    """
    if media_kind_for(media_path) == "video":
        keyframes = extract_video_keyframes(media_path)
        if keyframes is None or not keyframes.images:
            return None, MediaLoadError(FRAME_ERROR)
        return keyframes, None

    if media_path.suffix.lower() == GIF_EXTENSION:
        frame = extract_gif_first_frame(media_path)
        if frame is None:
            return None, MediaLoadError(READ_ERROR, "Failed to read GIF")
        return MediaFrames(images=[frame]), None

    images, error = load_image_rgb(media_path)
    if images is None:
        return None, MediaLoadError(READ_ERROR, error)
    return MediaFrames(images=images), None


def audio_part(audio_wav: bytes) -> dict:
    """The OpenAI ``input_audio`` content part, which vLLM and llama-server both take.

    A wrong key name here is invisible: the server drops the part and answers from the
    frames alone, so the caption comes back describing a silent clip that was not.
    """
    return {
        "type": "input_audio",
        "input_audio": {
            "data": base64.b64encode(audio_wav).decode("utf-8"),
            "format": AUDIO_FORMAT,
        },
    }


def timestamp_part(seconds: float) -> dict:
    """The ``<n.n seconds>`` marker Qwen3-VL's own video path emits before a frame.

    Copied from ``transformers`` ``processing_qwen3_vl.py`` down to the one decimal
    place and the spelling, because the point is to hand the model the exact string
    it was trained on rather than a paraphrase it has to interpret.
    """
    return {"type": "text", "text": f"<{seconds:.1f} seconds>"}


def vision_messages(
    system_prompt: str,
    images_b64: list[str],
    user_text: str,
    *,
    timestamps: list[float] | None = None,
    audio_wav: bytes | None = None,
) -> list[dict]:
    """The chat messages for one request: media parts first, the instruction last.

    Each frame is preceded by its timestamp when one is known, which is what lets
    the model tell a slow pan from a fast one - the frames alone say nothing about
    how much time separates them. Timestamps are dropped wholesale unless there is
    exactly one per frame, so a mismatch mislabels nothing.

    Ordering is the contract here: llama-server rewrites each media part in place,
    so array order is prompt order. This has *not* been verified for vLLM, where it
    depends on the chat template - if it were to reorder, the markers degrade to
    ordinary text near the frames rather than breaking the request.

    Audio sits between the frames and the text so the whole clip - what is seen and
    what is heard - is presented before it is asked about.
    """
    labelled = timestamps if timestamps and len(timestamps) == len(images_b64) else None

    content: list[dict] = []
    for index, encoded in enumerate(images_b64):
        if labelled is not None:
            content.append(timestamp_part(labelled[index]))
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
            }
        )

    if audio_wav:
        content.append(audio_part(audio_wav))
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
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    model: str | None = None,
    max_tokens: int | None = None,
    timestamps: list[float] | None = None,
    audio_wav: bytes | None = None,
) -> str | None:
    """Encode ``images`` and ask the model, returning the assistant text or ``None``.

    Both jobs assemble a request identically; only the pixel budget and the user text
    differ, so those arrive already resolved for the file's media kind. ``audio_wav``
    defaults to nothing sent, which is every request except an audio auto-caption.
    """
    images_b64 = prepare_images_for_api(images, max_pixels=max_pixels)
    if not images_b64:
        return None

    return run_vision_completion(
        client,
        vision_messages(
            system_prompt,
            images_b64,
            user_text,
            timestamps=timestamps,
            audio_wav=audio_wav,
        ),
        mode=mode,
        effort=effort,
        preserve_thinking=preserve_thinking,
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
    """Why a request that the server answered normally carried no caption.

    This is the failure that reports nothing anywhere: the server returns 200, the
    choice says it stopped of its own accord, ``completion_tokens`` is 0, and the
    content is an empty string - so the model server logs a served request, the SDK
    raises nothing, and the job used to record a bare ``api_error``. Everything the
    response does carry is worth having, because which field looks wrong is what
    separates the causes: a ``length`` finish means the generation budget ran out,
    a ``prompt_tokens`` well below what the same file reports on its own means the
    server reused a prompt prefix that did not belong to these frames, and content
    that is empty while ``reasoning_content`` is not means the model spent the whole
    budget thinking.
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


def run_vision_completion(
    client,
    messages: list[dict],
    *,
    mode: str,
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str | None:
    """Send a vision chat completion, returning the assistant text or ``None`` on failure.

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
        logger.error("Vision request to %s failed: %s", resolved_model, describe_exception(exc))
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
            "Vision request to %s returned no usable text (%s)",
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
