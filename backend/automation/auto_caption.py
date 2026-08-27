"""Vision-model auto-captioning adapted from re-caption_gguf.py."""

from __future__ import annotations

import logging
import textwrap
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from PIL import Image

from automation.audio import AUDIO_MAX_SECONDS, extract_audio_wav
from automation.job_runner import FileOutcome, run_media_job
from automation.llm import (
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_model_client,
    model_client,
)
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    MediaKind,
    keyframe_sentence,
    load_media_images,
    media_kind_for,
    media_kind_max_pixels,
    request_vision_text,
)
from captions import NO_CAPTION_STATUS, load_reference_caption, save_caption
from constants import IMAGE_EXTENSIONS, MOTION_EXTENSIONS, SYSPROMPT_FILENAME
from ffmpeg_bin import ffmpeg_path
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    get_max_tokens,
    get_openai_model,
    positive_env_int,
)
from sysprompt import load_sysprompt

logger = logging.getLogger(__name__)

# Longer reference captions are left alone; generated captions this short or shorter are retried.
DRAFT_CAPTION_THRESHOLD = 256
DRAFT_CAPTION_THRESHOLD_VAR = "DRAFT_CAPTION_THRESHOLD"


def get_draft_caption_threshold() -> int:
    return positive_env_int(DRAFT_CAPTION_THRESHOLD_VAR, DRAFT_CAPTION_THRESHOLD)


AUTO_CAPTION_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

# Missing audio on an audio run: counted, not failed; the file is still captioned as silent.
AUDIO_ERROR = "audio_error"

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


MEDIA_KINDS: tuple[MediaKind, ...] = ("image", "video")


# Without this a walking subject is captioned as standing.
MOTION_OBJECTIVE_SENTENCE = (
    "What changes between consecutive frames is directly observed, not speculation - "
    "compare them and state the motion that occurred, naming the action and its direction."
)

# One sentence only; a longer audio aside pulls the caption off what is on screen.
AUDIO_OBJECTIVE_SENTENCE = (
    "The clip's audio track is attached alongside the keyframes - analyze it as well and fold "
    "what is heard (speech, music, ambient sound, or silence) into the same caption."
)
AUDIO_USER_SENTENCE = (
    f"The clip's audio track is attached (up to the first {AUDIO_MAX_SECONDS} seconds)."
)


def _load_specific_sysprompt(folder: Path) -> str:
    specific_sys_prompt, _, _ = load_sysprompt(folder)
    if not specific_sys_prompt:
        raise ValueError("System prompt is empty")
    return specific_sys_prompt


def build_system_prompt(
    folder: Path,
    *,
    media_kind: MediaKind = "image",
    caption_audio: bool = False,
) -> str:
    """The system prompt for one media kind; audio wording stays even when the track is missing."""
    specific_sys_prompt = _load_specific_sysprompt(folder)
    # Inline so a single-line .sysprompt still dedents.
    audio_objective = f" {AUDIO_OBJECTIVE_SENTENCE}" if caption_audio else ""

    if media_kind == "video":
        return textwrap.dedent(
            f"""
            # Role
            You are an expert video captioning assistant specializing in high-density, descriptive captions for training generative AI LoRA models. Your specific task is to analyze a sequence of video keyframes in chronological order and describe the video with extreme accuracy and structural consistency.

            # Objective
            You are given keyframes extracted evenly across the video timeline, presented in chronological order. Treat them as a single continuous video. {MOTION_OBJECTIVE_SENTENCE} Generate one comprehensive, single-paragraph caption for the full video. Do not use conversational filler, introductions, or structural bullet points in the final output. Use the user provided description as **very close guidance** for analyzing the video and creating the caption; **never** change its meaning.{audio_objective}

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


def build_system_prompts(folder: Path, *, caption_audio: bool = False) -> dict[MediaKind, str]:
    return {
        kind: build_system_prompt(folder, media_kind=kind, caption_audio=caption_audio)
        for kind in MEDIA_KINDS
    }


def list_auto_caption_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, AUTO_CAPTION_EXTENSIONS, order="mtime")


def _build_user_text(
    ref_caption: str,
    media_kind: MediaKind,
    frame_count: int,
    *,
    has_audio: bool = False,
    seconds: float | None = None,
) -> str:
    """Per-request instruction; ``has_audio`` follows the attachment, not the job setting."""
    if media_kind == "video":
        audio_note = f" {AUDIO_USER_SENTENCE}" if has_audio else ""
        return textwrap.dedent(
            f"""
            Caption the video for LoRA training.

            {keyframe_sentence(frame_count, seconds)}{audio_note}

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
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    timestamps: list[float] | None = None,
    audio_wav: bytes | None = None,
    attempt: int = 1,
) -> str | None:
    """Caption already-loaded ``images``; ``attempt`` is for the JPEG re-encode workaround."""
    media_kind = media_kind_for(media_path)
    return request_vision_text(
        client,
        system_prompt,
        images,
        _build_user_text(
            ref_caption,
            media_kind,
            len(images),
            has_audio=audio_wav is not None,
            seconds=timestamps[-1] if timestamps else None,
        ),
        max_pixels=media_kind_max_pixels(
            media_kind, seconds=timestamps[-1] if timestamps else None
        ),
        mode=mode,
        effort=effort,
        preserve_thinking=preserve_thinking,
        model=model,
        max_tokens=max_tokens,
        timestamps=timestamps,
        audio_wav=audio_wav,
        attempt=attempt,
    )


def _read_draft_caption(media_path: Path) -> tuple[str | None, str]:
    ref_caption, status = load_reference_caption(media_path)
    if status != "ok" or ref_caption is None:
        return None, status

    if len(ref_caption) > get_draft_caption_threshold():
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
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    caption_audio: bool = False,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[Path, str | None, str, str | None, bool]:
    """Caption one file; the trailing flag is True only for motion media missing audio on an audio run."""
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()
    ref_caption, status = _read_draft_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None, False

    media_kind = media_kind_for(media_path)
    frames, load_error = load_media_images(media_path)
    if load_error is not None:
        return media_path, None, load_error.status, load_error.message, False

    # Extracted once so retries re-send the same bytes instead of decoding the clip three times.
    audio_wav = extract_audio_wav(media_path) if caption_audio and media_kind == "video" else None
    audio_missing = caption_audio and media_kind == "video" and audio_wav is None

    def attempt(number: int) -> ModelOutcome[str]:
        raw_caption = complete_caption(
            client,
            media_path,
            system_prompts[media_kind],
            ref_caption,
            images=frames.images,
            model=resolved_model,
            max_tokens=resolved_max_tokens,
            mode=mode,
            effort=effort,
            preserve_thinking=preserve_thinking,
            timestamps=frames.timestamps,
            audio_wav=audio_wav,
            attempt=number,
        )
        if raw_caption is None:
            return ModelOutcome(status="api_error")

        clean_text = clean_model_text(raw_caption)
        if len(clean_text.strip()) <= get_draft_caption_threshold():
            return ModelOutcome(status="too_short", value=clean_text)
        return ModelOutcome(status="success", value=clean_text)

    outcome = call_with_retries(
        attempt,
        job_label="Auto-caption",
        media_name=media_path.name,
        should_cancel=should_cancel,
        on_abandon=lambda: close_model_client(client),
    )
    return media_path, outcome.value, outcome.status, outcome.message, audio_missing


def validate_auto_caption_folder(folder: Path, *, caption_audio: bool = False) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    sysprompt_path = folder / SYSPROMPT_FILENAME
    if not sysprompt_path.is_file():
        raise ValueError(".sysprompt file is required for auto-captioning")

    if not list_auto_caption_media(folder):
        raise ValueError("No supported images or videos found in folder")

    # Without ffmpeg every clip would silently caption without audio.
    if caption_audio and ffmpeg_path() is None:
        raise ValueError("ffmpeg is required for audio captioning")


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
        AUDIO_ERROR: 0,
        "cancelled": 0,
    }


def _failure_outcome(status: str, message: str | None) -> FileOutcome:
    return FileOutcome(
        status=status,
        stats={status: 1} if status in NON_SUCCESS_STATUSES else {},
        fields={"message": message} if message else {},
    )


def _caption_outcome(
    media_path: Path,
    clean_text: str | None,
    status: str,
    message: str | None,
    should_cancel: Callable[[], bool] | None,
) -> FileOutcome:
    if status == "cancelled":
        return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

    if status == "success" and clean_text:
        if should_cancel and should_cancel():
            return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

        try:
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


def run_auto_caption_job(
    folder: Path,
    *,
    model: str | None = None,
    mode: str = "thinking",
    reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    caption_audio: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_auto_caption_folder(folder, caption_audio=caption_audio)

    system_prompts = build_system_prompts(folder, caption_audio=caption_audio)
    media_files = filter_media_list(list_auto_caption_media(folder), selected_paths)
    resolved_model = model if model is not None else get_openai_model()

    with model_client() as client:

        def process(media_path: Path) -> FileOutcome:
            _path, clean_text, status, message, audio_missing = process_media(
                client,
                media_path,
                system_prompts,
                model=resolved_model,
                mode=mode,
                effort=reasoning_effort,
                preserve_thinking=preserve_thinking,
                caption_audio=caption_audio,
                should_cancel=should_cancel,
            )

            outcome = _caption_outcome(media_path, clean_text, status, message, should_cancel)
            if not audio_missing or outcome.status == "cancelled":
                return outcome

            return replace(outcome, stats={**outcome.stats, AUDIO_ERROR: 1})

        return run_media_job(
            folder,
            media_files,
            stats=_initial_job_stats(len(media_files)),
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
            processed_stat_keys=PROCESSED_STAT_KEYS,
        )
