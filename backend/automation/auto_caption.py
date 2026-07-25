"""Vision-model auto-captioning adapted from re-caption_gguf.py."""

from __future__ import annotations

import base64
import logging
import os
import textwrap
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image

from constants import IMAGE_EXTENSIONS, SYSPROMPT_FILENAME, VIDEO_EXTENSIONS
from openai_settings import (
    create_openai_client,
    get_instruct_presence_penalty,
    get_instruct_temperature,
    get_instruct_top_p,
    get_max_tokens,
    get_openai_model,
    get_thinking_presence_penalty,
    get_thinking_temperature,
    get_thinking_top_p,
    get_top_k,
)
from sysprompt import load_sysprompt

logger = logging.getLogger(__name__)

DRAFT_CAPTION_THRESHOLD = 250
IMAGE_MAX_PIXELS = 1_000_000
VIDEO_FRAME_MAX_PIXELS = 500_000
VIDEO_KEYFRAME_COUNT = 12
MAX_MODEL_ATTEMPTS = 3

# Used as a trailing assistant prefill for "instruct" (non-thinking) mode on Qwen3 hybrid models.
# Signals that any thinking phase is complete/empty so the model emits the final answer directly.
INSTRUCT_THINK_PREFILL = "<think>\n\n</think>"

AUTO_CAPTION_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

MediaKind = Literal["image", "video"]

PROCESSED_STAT_KEYS = (
    "success",
    "no_txt",
    "read_error",
    "api_error",
    "frame_error",
    "too_short",
    "skipped_long",
    "write_error",
)

NON_SUCCESS_STATUSES = frozenset(
    {"no_txt", "read_error", "api_error", "frame_error", "too_short", "skipped_long"}
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]


@dataclass(frozen=True)
class MediaKindSettings:
    kind: MediaKind
    max_pixels: int


MEDIA_KIND_SETTINGS: dict[MediaKind, MediaKindSettings] = {
    "image": MediaKindSettings("image", IMAGE_MAX_PIXELS),
    "video": MediaKindSettings("video", VIDEO_FRAME_MAX_PIXELS),
}


def media_kind_for(path: Path) -> MediaKind:
    return "video" if path.suffix.lower() in VIDEO_EXTENSIONS else "image"


def resize_for_qwen(image: Image.Image, max_pixels: int = IMAGE_MAX_PIXELS) -> Image.Image:
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


def extract_video_keyframes(
    video_path: Path,
    count: int = VIDEO_KEYFRAME_COUNT,
) -> list[Image.Image] | None:
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.error("Failed to open video for keyframe extraction: %s", video_path.name)
        return None

    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        if total_frames <= 0:
            frames: list[Image.Image] = []
            while len(frames) < count:
                ok, frame = cap.read()
                if not ok:
                    break
                frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            return frames or None

        if total_frames == 1:
            indices = [0] * count
        else:
            indices = [round(index * (total_frames - 1) / (count - 1)) for index in range(count)]

        frames = []
        for frame_index in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                continue
            frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))

        return frames or None
    finally:
        cap.release()


def clean_caption(raw_text: str) -> str:
    text = raw_text.strip()

    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
    if "<think>" in text:
        text = text.split("<think>")[0].strip()

    prefixes = [
        "assistant:",
        "Assistant:",
        "Here is the caption:",
        "Caption:",
        "The image shows:",
        "The video shows:",
        "The caption is:",
        "Revised caption:",
        "Output:",
    ]
    text_lower = text.lower()
    for prefix in prefixes:
        if text_lower.startswith(prefix.lower()):
            text = text[len(prefix) :].strip()
            break

    return text.replace("<|im_end|>", "").replace("<|endoftext|>", "").strip()


def _load_specific_sysprompt(folder: Path) -> str:
    specific_sys_prompt, _, _ = load_sysprompt(folder)
    if not specific_sys_prompt:
        raise ValueError("System prompt is empty")
    return specific_sys_prompt


def build_system_prompt(folder: Path, *, media_kind: MediaKind = "image") -> str:
    specific_sys_prompt = _load_specific_sysprompt(folder)

    if media_kind == "video":
        return textwrap.dedent(
            f"""
            # Role
            You are an expert video captioning assistant specializing in high-density, descriptive captions for training generative AI LoRA models. Your specific task is to analyze a sequence of video keyframes in chronological order and describe the video with extreme accuracy and structural consistency.

            # Objective
            You are given {VIDEO_KEYFRAME_COUNT} keyframes extracted evenly across the video timeline, presented in chronological order. Treat them as a single continuous video. Generate one comprehensive, single-paragraph caption for the full video. Do not use conversational filler, introductions, or structural bullet points in the final output. Use the user provided description as **very close guidance** for analyzing the video and creating the caption; **never** change its meaning.

            {specific_sys_prompt}

            # Output Format
            A video caption that is factual, flowing, and concise (ideally 80-120 words). Focus only on what is clearly visible across the frame sequence. **Never** add artistic interpretation, poetic wording, mood speculation, or story elements.
            """
        ).strip()

    return textwrap.dedent(
        f"""
        # Role
        You are an expert image captioning assistant specializing in high-density, descriptive captions for training generative AI LoRA models. Your specific task is to analyze and describe images with extreme accuracy, structural consistency.

        # Objective
        Generate a comprehensive, single-paragraph caption for the provided image. Do not use conversational filler, introductions, or structural bullet points in the final output. Use the user provided description as **very close guidance** for analyzing the image and creating the caption; **never** change its meaning.

        {specific_sys_prompt}

        # Output Format
        An image caption that is factual, flowing, and concise (ideally 80-120 words). Focus only on what is clearly visible. **Never** add artistic interpretation, poetic wording, mood speculation, or story elements.
        """
    ).strip()


def build_system_prompts(folder: Path) -> dict[MediaKind, str]:
    return {kind: build_system_prompt(folder, media_kind=kind) for kind in MEDIA_KIND_SETTINGS}


def list_auto_caption_media(folder: Path) -> list[Path]:
    media_files: list[Path] = []
    try:
        entries = sorted(
            folder.iterdir(),
            key=lambda path: (os.path.getmtime(path), path.name.lower()),
        )
    except OSError:
        return []

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.suffix.lower() not in AUTO_CAPTION_EXTENSIONS:
            continue

        media_files.append(entry)

    return media_files


def _build_user_text(ref_caption: str, media_kind: MediaKind) -> str:
    if media_kind == "video":
        return textwrap.dedent(
            f"""
            Caption the video for LoRA training.

            You are given {VIDEO_KEYFRAME_COUNT} keyframes in chronological order. Analyze the full video sequence while following the system instructions.

            Use the provided description as **very close guidance** — keep its overall meaning and wording style as much as possible.
            Follow **all** rules from the system instructions exactly.

            User description:
            {ref_caption.strip()}
            """
        ).strip()

    return textwrap.dedent(
        f"""
        Caption the image for LoRA training.

        Use the provided description as **very close guidance** — keep its overall meaning and wording style as much as possible.
        Follow **all** rules from the system instructions exactly.

        User description:
        {ref_caption.strip()}
        """
    ).strip()


def _vision_messages(system_prompt: str, images_b64: list[str], user_text: str) -> list[dict]:
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


def _load_media_images(
    media_path: Path,
    media_kind: MediaKind,
) -> tuple[list[Image.Image] | None, str | None]:
    if media_kind == "video":
        keyframes = extract_video_keyframes(media_path)
        if not keyframes:
            return None, "frame_error"
        return keyframes, None

    try:
        return [Image.open(media_path).convert("RGB")], None
    except Exception as exc:
        logger.error("Image read error for %s: %s", media_path.name, exc)
        return None, "api_error"


def complete_caption(
    client,
    media_path: Path,
    system_prompt: str,
    ref_caption: str,
    *,
    images: list[Image.Image] | None = None,
    model: str | None = None,
    max_tokens: int | None = None,
    mode: str = "thinking",
) -> str | None:
    media_kind = media_kind_for(media_path)
    settings = MEDIA_KIND_SETTINGS[media_kind]
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()

    if images is None:
        images, _load_error = _load_media_images(media_path, media_kind)
        if images is None:
            return None

    images_b64 = prepare_images_for_api(images, max_pixels=settings.max_pixels)
    if not images_b64:
        return None

    if mode == "instruct":
        temperature = get_instruct_temperature()
        presence_penalty = get_instruct_presence_penalty()
        top_p = get_instruct_top_p()
    else:
        temperature = get_thinking_temperature()
        presence_penalty = get_thinking_presence_penalty()
        top_p = get_thinking_top_p()

    try:
        messages = _vision_messages(
            system_prompt,
            images_b64,
            _build_user_text(ref_caption, media_kind),
        )

        if mode == "instruct":
            # For Qwen3.6 (and 3.5) hybrid "thinking" models, the chat template controls
            # whether <think>...</think> reasoning is generated (via enable_thinking Jinja var).
            # LM Studio (llama.cpp backend) often does not reliably forward per-request
            # chat_template_kwargs through its OpenAI compat layer.
            #
            # Primary mechanism: Append a trailing assistant message containing an *empty*
            # think block. This is a "prefill" (last message = assistant) that, when combined
            # with template support for "continuing" the last assistant turn (see the Jinja
            # changes below), makes the prompt end right after the empty think so generation
            # continues the same assistant turn and skips new reasoning.
            #
            # Secondary: We still send chat_template_kwargs for servers that honor it
            # (vLLM, some LM Studio versions, direct llama-server, etc.).
            messages = [*messages, {"role": "assistant", "content": INSTRUCT_THINK_PREFILL}]

        extra_body: dict[str, object] = {"top_k": get_top_k()}
        if mode == "instruct":
            extra_body["chat_template_kwargs"] = {"enable_thinking": False}

        response = client.chat.completions.create(
            model=resolved_model,
            messages=messages,
            max_tokens=resolved_max_tokens,
            temperature=temperature,
            top_p=top_p,
            presence_penalty=presence_penalty,
            extra_body=extra_body,
        )

        raw = (response.choices[0].message.content or "").strip()
        return raw if raw else None
    except Exception as exc:
        logger.error("API/Vision error for %s: %s", media_path.name, exc)
        return None


def _read_draft_caption(media_path: Path) -> tuple[str | None, str]:
    txt_path = media_path.with_suffix(".txt")

    if not txt_path.exists():
        return None, "no_txt"

    try:
        ref_caption = txt_path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        return None, f"read_error: {exc}"

    if len(ref_caption) > DRAFT_CAPTION_THRESHOLD:
        return None, "skipped_long"

    return ref_caption, "ok"


def process_media(
    client,
    media_path: Path,
    system_prompts: dict[MediaKind, str],
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    mode: str = "thinking",
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[Path, str | None, str]:
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()
    ref_caption, status = _read_draft_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status

    media_kind = media_kind_for(media_path)
    images, load_error = _load_media_images(media_path, media_kind)
    if load_error:
        return media_path, None, load_error

    last_status = "api_error"
    last_caption: str | None = None

    for attempt in range(1, MAX_MODEL_ATTEMPTS + 1):
        if should_cancel and should_cancel():
            return media_path, None, "cancelled"

        raw_caption = complete_caption(
            client,
            media_path,
            system_prompts[media_kind],
            ref_caption,
            images=images,
            model=resolved_model,
            max_tokens=resolved_max_tokens,
            mode=mode,
        )

        if raw_caption is None:
            last_status = "api_error"
            last_caption = None
        else:
            if should_cancel and should_cancel():
                return media_path, None, "cancelled"

            clean_text = clean_caption(raw_caption)
            if len(clean_text.strip()) > DRAFT_CAPTION_THRESHOLD:
                return media_path, clean_text, "success"

            last_status = "too_short"
            last_caption = clean_text

        if attempt < MAX_MODEL_ATTEMPTS:
            logger.warning(
                "Auto-caption attempt %s/%s failed for %s (%s); retrying",
                attempt,
                MAX_MODEL_ATTEMPTS,
                media_path.name,
                last_status,
            )

    return media_path, last_caption, last_status


def validate_auto_caption_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    sysprompt_path = folder / SYSPROMPT_FILENAME
    if not sysprompt_path.is_file():
        raise ValueError(".sysprompt file is required for auto-captioning")

    if not list_auto_caption_media(folder):
        raise ValueError("No supported images or videos found in folder")


def _initial_job_stats(total: int) -> dict[str, int]:
    return {
        "total": total,
        "success": 0,
        "no_txt": 0,
        "read_error": 0,
        "api_error": 0,
        "frame_error": 0,
        "too_short": 0,
        "skipped_long": 0,
        "write_error": 0,
        "cancelled": 0,
    }


def _record_result_status(
    stats: dict[str, int],
    result: dict[str, object],
    status: str,
) -> None:
    base_status = status.split(":", 1)[0]
    if base_status in NON_SUCCESS_STATUSES:
        stats[base_status] += 1
        if base_status == "read_error":
            result["message"] = status.split(":", 1)[1].strip() if ":" in status else status


def run_auto_caption_job(
    folder: Path,
    *,
    model: str | None = None,
    mode: str = "thinking",
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    from automation.selection import filter_media_list

    validate_auto_caption_folder(folder)

    system_prompts = build_system_prompts(folder)
    media_files = filter_media_list(list_auto_caption_media(folder), selected_paths)
    client = create_openai_client()
    resolved_model = model if model is not None else get_openai_model()

    stats = _initial_job_stats(len(media_files))
    file_results: list[dict[str, object]] = []
    total = len(media_files)

    for index, media_path in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            stats["cancelled"] = total - index + 1
            break

        if on_progress:
            on_progress(str(media_path), media_path.name, index - 1, total, dict(stats))

        media_path, clean_text, status = process_media(
            client,
            media_path,
            system_prompts,
            model=resolved_model,
            mode=mode,
            should_cancel=should_cancel,
        )

        result: dict[str, object] = {
            "path": str(media_path),
            "name": media_path.name,
            "status": status.split(":", 1)[0],
        }

        if status == "success" and clean_text:
            if should_cancel and should_cancel():
                stats["cancelled"] += 1
                result["status"] = "cancelled"
                # Do not write sidecar if cancellation was requested around this file's processing.
            else:
                try:
                    media_path.with_suffix(".txt").write_text(clean_text, encoding="utf-8")
                    stats["success"] += 1
                    result["description"] = clean_text
                except OSError as exc:
                    stats["write_error"] += 1
                    result["status"] = "write_error"
                    result["message"] = str(exc)
        elif status == "cancelled":
            stats["cancelled"] += 1
            result["status"] = "cancelled"
        else:
            _record_result_status(stats, result, status)

        file_results.append(result)

        if on_progress:
            on_progress(str(media_path), media_path.name, index, total, dict(stats))

        if status == "cancelled":
            # Abort further files; account for any not-yet-processed remaining ones.
            remaining_after_current = total - index
            if remaining_after_current > 0:
                stats["cancelled"] += remaining_after_current
            break

    processed = sum(stats[key] for key in PROCESSED_STAT_KEYS)

    return {
        "folder": str(folder),
        "total": stats["total"],
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }
