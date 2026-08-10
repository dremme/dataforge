"""Vision-model auto-captioning adapted from re-caption_gguf.py."""

from __future__ import annotations

import logging
import textwrap
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    VIDEO_FRAME_MAX_PIXELS,
    MediaKind,
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_vision_client,
    keyframe_sentence,
    load_media_images,
    media_kind_for,
    request_vision_text,
    vision_client,
)
from captions import NO_CAPTION_STATUS, load_reference_caption, save_caption
from constants import IMAGE_EXTENSIONS, MOTION_EXTENSIONS, SYSPROMPT_FILENAME
from openai_settings import get_max_tokens, get_openai_model
from sysprompt import load_sysprompt

logger = logging.getLogger(__name__)

DRAFT_CAPTION_THRESHOLD = 250
IMAGE_MAX_PIXELS = 1_000_000

AUTO_CAPTION_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

PROCESSED_STAT_KEYS = (
    "success",
    NO_CAPTION_STATUS,
    "read_error",
    "api_error",
    "frame_error",
    "too_short",
    "skipped_long",
    "write_error",
)

NON_SUCCESS_STATUSES = frozenset(
    {NO_CAPTION_STATUS, "read_error", "api_error", "frame_error", "too_short", "skipped_long"}
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]


# Captioning reads the whole frame, so a still gets the larger budget; keyframes are
# sent dozens at a time, scaling with the clip's length, and have to stay small enough
# for the request to be tractable.
MEDIA_KIND_MAX_PIXELS: dict[MediaKind, int] = {
    "image": IMAGE_MAX_PIXELS,
    "video": VIDEO_FRAME_MAX_PIXELS,
}


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
            You are given keyframes extracted evenly across the video timeline, presented in chronological order. Treat them as a single continuous video. Generate one comprehensive, single-paragraph caption for the full video. Do not use conversational filler, introductions, or structural bullet points in the final output. Use the user provided description as **very close guidance** for analyzing the video and creating the caption; **never** change its meaning.

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
    return {kind: build_system_prompt(folder, media_kind=kind) for kind in MEDIA_KIND_MAX_PIXELS}


def list_auto_caption_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, AUTO_CAPTION_EXTENSIONS, order="mtime")


def _build_user_text(ref_caption: str, media_kind: MediaKind, frame_count: int) -> str:
    if media_kind == "video":
        return textwrap.dedent(
            f"""
            Caption the video for LoRA training.

            {keyframe_sentence(frame_count)}

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


def complete_caption(
    client,
    media_path: Path,
    system_prompt: str,
    ref_caption: str,
    *,
    images: list[Image.Image],
    model: str | None = None,
    max_tokens: int | None = None,
    mode: str = "thinking",
) -> str | None:
    """Ask the model to caption ``images``, which the caller has already loaded.

    Decoding stays with ``process_media`` so a file that never opened is reported as
    such instead of being retried three times as a model failure.
    """
    media_kind = media_kind_for(media_path)
    return request_vision_text(
        client,
        system_prompt,
        images,
        _build_user_text(ref_caption, media_kind, len(images)),
        max_pixels=MEDIA_KIND_MAX_PIXELS[media_kind],
        mode=mode,
        model=model,
        max_tokens=max_tokens,
    )


def _read_draft_caption(media_path: Path) -> tuple[str | None, str]:
    ref_caption, status = load_reference_caption(media_path)
    if status != "ok" or ref_caption is None:
        return None, status

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
) -> tuple[Path, str | None, str, str | None]:
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()
    ref_caption, status = _read_draft_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None

    media_kind = media_kind_for(media_path)
    images, load_error = load_media_images(media_path)
    if load_error is not None:
        return media_path, None, load_error.status, load_error.message

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
        on_abandon=lambda: close_vision_client(client),
    )
    return media_path, outcome.value, outcome.status, outcome.message


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
        NO_CAPTION_STATUS: 0,
        "read_error": 0,
        "api_error": 0,
        "frame_error": 0,
        "too_short": 0,
        "skipped_long": 0,
        "write_error": 0,
        "cancelled": 0,
    }


def _failure_outcome(status: str, message: str | None) -> FileOutcome:
    """Map a non-success ``process_media`` status onto its counter and message."""
    return FileOutcome(
        status=status,
        stats={status: 1} if status in NON_SUCCESS_STATUSES else {},
        fields={"message": message} if message else {},
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
    resolved_model = model if model is not None else get_openai_model()

    with vision_client() as client:

        def process(media_path: Path) -> FileOutcome:
            _path, clean_text, status, message = process_media(
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
                    # Writes back into the winning sidecar, so a .json caption is
                    # updated in place instead of being shadowed by a new .txt.
                    save_caption(media_path, clean_text)
                except (OSError, ValueError) as exc:
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

            return _failure_outcome(status, message)

        return run_media_job(
            folder,
            media_files,
            stats=_initial_job_stats(len(media_files)),
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
            processed_stat_keys=PROCESSED_STAT_KEYS,
        )
