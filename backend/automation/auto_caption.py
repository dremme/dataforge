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
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    MediaKind,
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_vision_client,
    keyframe_sentence,
    load_media_images,
    media_kind_for,
    media_kind_max_pixels,
    request_vision_text,
    vision_client,
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

#: Characters. One knob, two gates: a reference caption longer than this is already a
#: finished caption and is left alone, and a freshly generated one this short or shorter
#: is not an answer and is retried. Read per call so a configured value reaches both.
DRAFT_CAPTION_THRESHOLD = 256
DRAFT_CAPTION_THRESHOLD_VAR = "DRAFT_CAPTION_THRESHOLD"


def get_draft_caption_threshold() -> int:
    return positive_env_int(DRAFT_CAPTION_THRESHOLD_VAR, DRAFT_CAPTION_THRESHOLD)


AUTO_CAPTION_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS

#: Motion media that carried no audio track while audio captioning was on. Counted, not
#: failed: the file is still captioned, and the model is expected to call it silent.
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


#: Added to every video prompt. Without it a walking subject gets captioned as standing:
#: the Output Format section asks for what is "clearly visible" and forbids speculation,
#: and motion is only readable as change between frames. One sentence, like the audio one.
MOTION_OBJECTIVE_SENTENCE = (
    "What changes between consecutive frames is directly observed, not speculation - "
    "compare them and state the motion that occurred, naming the action and its direction."
)

#: Added to the video prompts only while audio captioning is on. Kept to one sentence
#: each: the rest of the prompt is calibrated, and a longer aside about sound pulls the
#: caption toward the audio at the expense of what is on screen.
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
    """The system prompt for one media kind, optionally asking for the audio too.

    The audio sentence goes in for every video once the option is on, including clips
    whose track turned out to be missing: being told to describe the sound is what makes
    the model report a silent clip instead of ignoring the subject.
    """
    specific_sys_prompt = _load_specific_sysprompt(folder)
    # Interpolated inline rather than as its own line so a single-line .sysprompt still
    # dedents the way it does today.
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
    """The instruction for one request, which states what that request actually carries.

    ``has_audio`` tracks the attachment rather than the job's setting: a silent clip is
    sent with the audio sentence left out, so nothing invites the model to describe a
    track that is not there. The system prompt still asks about sound, which is what
    makes it report the silence.
    """
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
    """Ask the model to caption ``images``, which the caller has already loaded.

    Decoding stays with ``process_media`` so a file that never opened is reported as
    such instead of being retried three times as a model failure. ``audio_wav`` and
    ``timestamps`` follow the same rule: resolved once by the caller, sent again on
    every retry.

    ``attempt`` is passed straight through to the frame encoding, which is a workaround
    rather than a feature - ``vision.retry_jpeg_quality`` explains why a retry must not
    resend the bytes that just failed.
    """
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
    """Caption one file, reporting the outcome and whether its audio was missing.

    The trailing flag is only ever ``True`` for motion media on an audio run; a still
    has no track to miss, and a job with audio off never looks for one.
    """
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()
    ref_caption, status = _read_draft_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None, False

    media_kind = media_kind_for(media_path)
    frames, load_error = load_media_images(media_path)
    if load_error is not None:
        return media_path, None, load_error.status, load_error.message, False

    # Extracted once, outside ``attempt``, so three retries re-send the same bytes
    # instead of decoding the clip three times.
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
        on_abandon=lambda: close_vision_client(client),
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

    # Checked once up front rather than per file: without ffmpeg every clip in the
    # folder would silently caption without audio, which is not what was asked for.
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
    """Map a non-success ``process_media`` status onto its counter and message."""
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
    """What one captioned file did to the job, before the audio counter rides along."""
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

    with vision_client() as client:

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

            # The clip was captioned regardless, so this counts alongside whatever the
            # caption attempt made of it rather than replacing it.
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
