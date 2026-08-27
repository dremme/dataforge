"""Sending media to the local model, for the auto-caption and verify-captions jobs."""

from __future__ import annotations

import base64
import logging
import math
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image

from automation.audio import AUDIO_FORMAT
from automation.llm import run_chat_completion
from constants import GIF_EXTENSION, VIDEO_EXTENSIONS
from gif_frames import extract_gif_first_frame, keyframe_indices
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    positive_env_int,
)

logger = logging.getLogger(__name__)

JPEG_QUALITY = 85

VIDEO_KEYFRAME_COUNT = 8
KEYFRAMES_PER_SECOND = 2
# Cap: every frame is inlined; 2 * 20s + 2 endpoints is as long as current vision models take.
MAX_VIDEO_KEYFRAME_COUNT = 42
# Above this, fps is usually an MPEG timescale of 90000, not a fast camera.
MAX_PLAUSIBLE_FPS = 1000.0
# Walk back this far when CAP_PROP_FRAME_COUNT overshoots the decodable tail.
TAIL_SEEK_LIMIT = 32
QWEN_MIN_SIDE_PX = 512
# Below this both sides floor and a 16:9 frame comes out square.
MIN_HONORED_MAX_PIXELS = QWEN_MIN_SIDE_PX * QWEN_MIN_SIDE_PX

VIDEO_FRAME_MAX_PIXELS = 500_000
VIDEO_FRAME_SCALE_START_SECONDS = 7.0
VIDEO_FRAME_SCALE_END_SECONDS = 20.0
IMAGE_MAX_PIXELS = 1_500_000

# Defaults above; read per call, not at import, so env overrides reach the frames.
KEYFRAMES_PER_SECOND_VAR = "VIDEO_KEYFRAMES_PER_SECOND"
MAX_VIDEO_KEYFRAMES_VAR = "VIDEO_MAX_KEYFRAMES"
VIDEO_FRAME_MAX_PIXELS_VAR = "VIDEO_FRAME_MAX_PIXELS"
VIDEO_FRAME_MIN_PIXELS_VAR = "VIDEO_FRAME_MIN_PIXELS"
IMAGE_MAX_PIXELS_VAR = "IMAGE_MAX_PIXELS"


def get_keyframes_per_second() -> int:
    return positive_env_int(KEYFRAMES_PER_SECOND_VAR, KEYFRAMES_PER_SECOND)


def get_max_video_keyframes() -> int:
    return positive_env_int(MAX_VIDEO_KEYFRAMES_VAR, MAX_VIDEO_KEYFRAME_COUNT)


def get_video_frame_max_pixels() -> int:
    return positive_env_int(VIDEO_FRAME_MAX_PIXELS_VAR, VIDEO_FRAME_MAX_PIXELS)


def get_video_frame_min_pixels() -> int:
    return positive_env_int(VIDEO_FRAME_MIN_PIXELS_VAR, MIN_HONORED_MAX_PIXELS)


def get_qwen_min_side_px() -> int:
    """Per-side floor on Qwen's 32-pixel grid; never raised above ``QWEN_MIN_SIDE_PX``."""
    aligned = max(32, (math.isqrt(get_video_frame_min_pixels()) // 32) * 32)
    return min(QWEN_MIN_SIDE_PX, aligned)


def get_image_max_pixels() -> int:
    return positive_env_int(IMAGE_MAX_PIXELS_VAR, IMAGE_MAX_PIXELS)


READ_ERROR = "read_error"
FRAME_ERROR = "frame_error"

MediaKind = Literal["image", "video"]


def video_frame_max_pixels_for_seconds(seconds: float | None) -> int:
    """Per-frame pixel budget; from 7s it lerps down to the 512px-side floor at 20s."""
    configured = get_video_frame_max_pixels()
    floor = min(configured, get_video_frame_min_pixels())
    if seconds is None or not math.isfinite(seconds) or seconds <= VIDEO_FRAME_SCALE_START_SECONDS:
        return configured
    if seconds >= VIDEO_FRAME_SCALE_END_SECONDS:
        return floor
    span = VIDEO_FRAME_SCALE_END_SECONDS - VIDEO_FRAME_SCALE_START_SECONDS
    t = (seconds - VIDEO_FRAME_SCALE_START_SECONDS) / span
    return round(configured + (floor - configured) * t)


def media_kind_max_pixels(media_kind: MediaKind, *, seconds: float | None = None) -> int:
    """Per-frame pixel budget, resolved per call so env overrides reach the frames."""
    if media_kind == "image":
        return get_image_max_pixels()
    return video_frame_max_pixels_for_seconds(seconds)


def resize_for_qwen(image: Image.Image, max_pixels: int) -> Image.Image:
    """Downscale to ``max_pixels``, keeping both sides on Qwen's 32-pixel patch grid."""
    width, height = image.size
    current_pixels = width * height
    if current_pixels <= max_pixels:
        return image

    scale = (max_pixels / current_pixels) ** 0.5
    min_side = get_qwen_min_side_px()
    new_width = max((int(width * scale) // 32) * 32, min_side)
    new_height = max((int(height * scale) // 32) * 32, min_side)
    return image.resize((new_width, new_height), Image.Resampling.LANCZOS)


def retry_jpeg_quality(attempt: int) -> int:
    """WORKAROUND: vary JPEG quality per attempt so llama.cpp cannot short-circuit identical retries."""
    return max(JPEG_QUALITY - (attempt - 1), 1)


def image_to_base64(image: Image.Image, *, quality: int = JPEG_QUALITY) -> str:
    buffered = BytesIO()
    image.save(buffered, format="JPEG", quality=quality)
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def prepare_images_for_api(
    images: list[Image.Image],
    *,
    max_pixels: int,
    quality: int = JPEG_QUALITY,
) -> list[str] | None:
    encoded: list[str] = []
    for image in images:
        try:
            resized = resize_for_qwen(image.convert("RGB"), max_pixels=max_pixels)
            encoded.append(image_to_base64(resized, quality=quality))
        except Exception as exc:
            logger.error("Image prepare error: %s", exc)
            return None
    return encoded


def load_image_rgb(media_path: Path) -> tuple[list[Image.Image] | None, str | None]:
    """Open a still and close the handle; Pillow otherwise locks multi-frame files on Windows."""
    try:
        with Image.open(media_path) as image:
            return [image.convert("RGB")], None
    except Exception as exc:
        logger.error("Image read error for %s: %s", media_path.name, exc)
        return None, str(exc)


def media_kind_for(path: Path) -> MediaKind:
    """How a file is captioned or verified; a GIF is treated as an image."""
    return "video" if path.suffix.lower() in VIDEO_EXTENSIONS else "image"


@dataclass(frozen=True)
class MediaFrames:
    """Frames for one request; ``timestamps`` is None unless there is one entry per frame."""

    images: list[Image.Image]
    timestamps: list[float] | None = None


def keyframe_count_for_seconds(seconds: float | None) -> int:
    """How many frames a clip of this length is worth sampling; short clips keep the floor."""
    if seconds is None or not math.isfinite(seconds) or seconds <= 0:
        return VIDEO_KEYFRAME_COUNT

    wanted = get_keyframes_per_second() * math.ceil(seconds) + 2
    return min(max(wanted, VIDEO_KEYFRAME_COUNT), get_max_video_keyframes())


def _video_fps(cap, cv2) -> float | None:
    """How fast the clip runs, or ``None`` when the container will not say usefully."""
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if not math.isfinite(fps) or fps <= 0 or fps > MAX_PLAUSIBLE_FPS:
        return None
    return fps


def _video_seconds(fps: float | None, total_frames: int) -> float | None:
    """How long the clip runs, given a rate ``_video_fps`` already vetted."""
    return None if fps is None else total_frames / fps


def _capped(image: Image.Image, seconds: float | None = None) -> Image.Image:
    """A keyframe at the multi-frame budget, applied as it is read so 4K frames are not held full-size."""
    return resize_for_qwen(image, max_pixels=video_frame_max_pixels_for_seconds(seconds))


def _read_frame_at(cap, cv2, frame_index: int, seconds: float | None = None) -> Image.Image | None:
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = cap.read()
    if not ok:
        return None
    return _capped(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), seconds)


def _seek_keyframes(cap, cv2, total_frames: int, count: int, fps: float | None) -> MediaFrames:
    """Sample a video whose length is known, ending on its real last frame."""
    seconds = _video_seconds(fps, total_frames)
    wanted = keyframe_indices(total_frames, count)
    captured = {
        index: image for index in wanted if (image := _read_frame_at(cap, cv2, index, seconds))
    }

    last_wanted = wanted[-1] if wanted else 0
    if wanted and last_wanted not in captured:
        # CAP_PROP_FRAME_COUNT overshoots the decodable tail; walk back to a frame that reads.
        floor = max(captured, default=-1)
        limit = max(floor, last_wanted - TAIL_SEEK_LIMIT)
        for index in range(last_wanted - 1, limit, -1):
            image = _read_frame_at(cap, cv2, index, seconds)
            if image is not None:
                captured[index] = image
                break

    indices = sorted(captured)
    return MediaFrames(
        images=[captured[index] for index in indices],
        timestamps=None if fps is None else [index / fps for index in indices],
    )


def _streamed_keyframes(cap, cv2, count: int) -> MediaFrames:
    """Sample a video whose length is unknown; no timestamps because the halving stride breaks them."""
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
    """Evenly spaced frames spanning the whole clip, first and last included."""
    import cv2

    # release() also covers failed-open: an unopened capture still locks the file on Windows.
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
    """States the real frame count; omit ``seconds`` to keep the unlabelled sentence."""
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
    """Why a file never reached the model; ``status`` is the job counter key."""

    status: str
    message: str | None = None


def load_media_images(
    media_path: Path,
) -> tuple[MediaFrames | None, MediaLoadError | None]:
    """Load a video's keyframes or a single still; GIFs skip ``load_image_rgb`` (uncomposited RGB)."""
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
    """The OpenAI ``input_audio`` content part; a wrong key is dropped silently by the server."""
    return {
        "type": "input_audio",
        "input_audio": {
            "data": base64.b64encode(audio_wav).decode("utf-8"),
            "format": AUDIO_FORMAT,
        },
    }


def timestamp_part(seconds: float) -> dict:
    """The ``<n.n seconds>`` marker Qwen3-VL was trained on; spelling and one decimal are the contract."""
    return {"type": "text", "text": f"<{seconds:.1f} seconds>"}


def vision_messages(
    system_prompt: str,
    images_b64: list[str],
    user_text: str,
    *,
    timestamps: list[float] | None = None,
    audio_wav: bytes | None = None,
) -> list[dict]:
    """Media parts first, instruction last; timestamps are dropped unless there is one per frame."""
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
    attempt: int = 1,
) -> str | None:
    """Encode ``images`` and ask the model; ``attempt`` only reaches JPEG quality."""
    images_b64 = prepare_images_for_api(
        images, max_pixels=max_pixels, quality=retry_jpeg_quality(attempt)
    )
    if not images_b64:
        return None

    return run_chat_completion(
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
