"""Vision-model auto-captioning adapted from re-caption_gguf.py."""

from __future__ import annotations

import logging
import textwrap
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PIL import Image

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    load_image_rgb,
    prepare_images_for_api,
    run_vision_completion,
    vision_messages,
)
from constants import IMAGE_EXTENSIONS, SYSPROMPT_FILENAME, VIDEO_EXTENSIONS
from openai_settings import create_openai_client, get_max_tokens, get_openai_model
from sysprompt import load_sysprompt

logger = logging.getLogger(__name__)

DRAFT_CAPTION_THRESHOLD = 250
IMAGE_MAX_PIXELS = 1_000_000
VIDEO_FRAME_MAX_PIXELS = 500_000
VIDEO_KEYFRAME_COUNT = 12

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
    return list_folder_media(folder, AUTO_CAPTION_EXTENSIONS, order="mtime")


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


def _load_media_images(
    media_path: Path,
    media_kind: MediaKind,
) -> tuple[list[Image.Image] | None, str | None]:
    if media_kind == "video":
        keyframes = extract_video_keyframes(media_path)
        if not keyframes:
            return None, "frame_error"
        return keyframes, None

    images, _error = load_image_rgb(media_path)
    if images is None:
        return None, "api_error"
    return images, None


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

    if images is None:
        images, _load_error = _load_media_images(media_path, media_kind)
        if images is None:
            return None

    images_b64 = prepare_images_for_api(images, max_pixels=settings.max_pixels)
    if not images_b64:
        return None

    return run_vision_completion(
        client,
        vision_messages(system_prompt, images_b64, _build_user_text(ref_caption, media_kind)),
        mode=mode,
        model=model if model is not None else get_openai_model(),
        max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
    )


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

    def attempt() -> ModelOutcome[str]:
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
            return ModelOutcome(status="api_error")

        clean_text = clean_model_text(raw_caption)
        if len(clean_text.strip()) <= DRAFT_CAPTION_THRESHOLD:
            return ModelOutcome(status="too_short", value=clean_text)
        return ModelOutcome(status="success", value=clean_text)

    outcome = call_with_retries(
        attempt,
        job_label="Auto-caption",
        media_name=media_path.name,
        should_cancel=should_cancel,
    )
    return media_path, outcome.value, outcome.status


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


def _failure_outcome(status: str) -> FileOutcome:
    """Map a non-success ``process_media`` status onto its counter and message."""
    base_status, _, detail = status.partition(":")
    fields: dict[str, object] = {}
    if base_status == "read_error":
        fields["message"] = detail.strip() or status

    return FileOutcome(
        status=base_status,
        stats={base_status: 1} if base_status in NON_SUCCESS_STATUSES else {},
        fields=fields,
    )


def run_auto_caption_job(
    folder: Path,
    *,
    model: str | None = None,
    mode: str = "thinking",
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_auto_caption_folder(folder)

    system_prompts = build_system_prompts(folder)
    media_files = filter_media_list(list_auto_caption_media(folder), selected_paths)
    client = create_openai_client()
    resolved_model = model if model is not None else get_openai_model()

    def process(media_path: Path) -> FileOutcome:
        _path, clean_text, status = process_media(
            client,
            media_path,
            system_prompts,
            model=resolved_model,
            mode=mode,
            should_cancel=should_cancel,
        )

        if status == "cancelled":
            return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

        if status == "success" and clean_text:
            if should_cancel and should_cancel():
                # Do not write the sidecar when cancellation landed around this file.
                return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

            try:
                media_path.with_suffix(".txt").write_text(clean_text, encoding="utf-8")
            except OSError as exc:
                return FileOutcome(
                    status="write_error",
                    stats={"write_error": 1},
                    fields={"message": str(exc)},
                )

            return FileOutcome(
                status="success",
                stats={"success": 1},
                fields={"description": clean_text},
            )

        return _failure_outcome(status)

    return run_media_job(
        folder,
        media_files,
        stats=_initial_job_stats(len(media_files)),
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=PROCESSED_STAT_KEYS,
    )
