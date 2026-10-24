"""Rewrite existing captions with the local model, from a user instruction.

With vision on, each caption's image or video keyframes go along so the edit can check and add
what the media shows."""

from __future__ import annotations

import textwrap
from pathlib import Path

from automation.backup_captions import back_up_caption, caption_backup_dir
from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_caption_job
from automation.llm import (
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_model_client,
    model_client,
    run_chat_completion,
    strip_code_fences,
)
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    FRAME_ERROR,
    MediaFrames,
    MediaKind,
    MediaLoadError,
    keyframe_sentence,
    load_media_images,
    media_kind_for,
    media_kind_max_pixels,
    request_vision_text,
)
from captions import (
    CAPTION_CHANGED_STATUS,
    NO_CAPTION_STATUS,
    CaptionConflictError,
    CaptionTarget,
    caption_targets,
    load_reference_caption,
    save_caption,
)
from constants import CAPTION_EDIT_PREVIEW_LIMIT, MEDIA_EXTENSIONS
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    get_openai_model,
)
from schemas import AutomationMode, CaptionEditPreviewSample, EditCaptionsPreviewResponse

REJECTED = "rejected"
UNCHANGED = "unchanged"

# Every terminal per-file status; omitting one stops the progress bar short of ``total``.
PROCESSED_STAT_KEYS = (
    "success",
    UNCHANGED,
    REJECTED,
    NO_CAPTION_STATUS,
    "read_error",
    FRAME_ERROR,
    "api_error",
    "write_error",
    CAPTION_CHANGED_STATUS,
)

MIN_EDIT_LENGTH_RATIO = 0.25
MAX_EDIT_LENGTH_RATIO = 4.0
# With the media in hand an edit may rightly grow a short caption past the ratio.
MAX_VISION_EDIT_CHARS = 1500

# Floor for a collapsed caption ("shorten to one sentence"); not ``DRAFT_CAPTION_THRESHOLD``.
MIN_EDITED_CAPTION_CHARS = 40

_QUOTE_PAIRS = (('"', '"'), ("'", "'"), ("“", "”"))


#: What the model is sent alongside the caption, and how the rules refer to it.
_VISION_MEDIA_WORDING: dict[MediaKind, tuple[str, str]] = {
    "image": ("the image it describes", "the image"),
    "video": ("keyframes from the video it describes", "the keyframes"),
}


def build_edit_system_prompt(instruction: str, *, media_kind: MediaKind | None = None) -> str:
    """Assemble the system prompt once per job so the prefix cache stays warm.

    ``media_kind`` is set only when the media is sent with the caption."""
    if media_kind is None:
        given = "The caption text is all you are given."
        keep_rule = (
            "- Keep every detail the caption already states, unless the edit is to remove it."
        )
        add_rule = "- Add nothing the caption does not already state."
    else:
        sent, seen = _VISION_MEDIA_WORDING[media_kind]
        given = f"You are also given {sent}. Use {seen} to check and add what the edit asks for."
        keep_rule = (
            "- Keep every detail the caption already states, unless the edit is to remove or "
            "correct it."
        )
        add_rule = f"- Add only details the edit asks for that are clearly visible in {seen}."

    sections = [
        textwrap.dedent(
            """
            # Role
            You are a caption editor for LoRA training data.
            """
        ).strip(),
        "# Objective\nRewrite the caption you are given so that it satisfies the requested "
        f"edit, and return the rewritten caption. {given}",
        f"# Edit to apply\n{instruction.strip()}",
        # Keep this list to judging; output mechanics here once regressed verify-captions.
        "\n".join(
            (
                "# Rules",
                "- Make the requested edit and change nothing else.",
                keep_rule,
                add_rule,
                "- When the edit does not apply to this caption, return the caption unchanged.",
            )
        ),
        textwrap.dedent(
            """
            # Output Format
            Reply with the edited caption and nothing else: plain prose, no quotation marks
            around it, no code fences, no markdown, no preamble, and no note about what you
            changed. The first character of your reply is the first character of the caption.
            """
        ).strip(),
    ]

    return "\n\n".join(sections)


def build_edit_system_prompts(instruction: str, *, vision: bool) -> dict[MediaKind, str]:
    """One prompt per media kind; without vision both kinds share the text-only prompt."""
    if not vision:
        prompt = build_edit_system_prompt(instruction)
        return {"image": prompt, "video": prompt}
    return {
        kind: build_edit_system_prompt(instruction, media_kind=kind)
        for kind in _VISION_MEDIA_WORDING
    }


def build_edit_user_text(
    caption: str,
    media_kind: MediaKind | None = None,
    frame_count: int = 1,
    seconds: float | None = None,
) -> str:
    """``media_kind`` is set only when the media is sent with the caption."""
    if media_kind == "video":
        media_line = f"{keyframe_sentence(frame_count, seconds)}\n"
    elif media_kind == "image":
        media_line = "The image this caption describes is attached.\n"
    else:
        media_line = ""
    return (
        f"Caption to edit:\n{caption.strip()}\n\n"
        f"{media_line}"
        "Apply the edit from the system instructions to this caption. "
        "Output only the edited caption."
    )


def strip_wrapping_quotes(text: str) -> str:
    """Drop one wrapping quote pair, keeping a caption that is itself a quotation."""
    stripped = text.strip()
    if len(stripped) < 2:
        return stripped

    for opening, closing in _QUOTE_PAIRS:
        if stripped.startswith(opening) and stripped.endswith(closing):
            interior = stripped[1:-1]
            if opening not in interior and closing not in interior:
                return interior.strip()

    return stripped


def clean_edited_caption(raw_text: str) -> str:
    """Reduce a model reply to the caption it was supposed to be on its own."""
    return strip_wrapping_quotes(strip_code_fences(clean_model_text(raw_text))).strip()


def edit_rejection_reason(original: str, edited: str, *, vision: bool = False) -> str | None:
    """Why this reply is not an edited caption, or ``None`` when it is."""
    edited = edited.strip()
    if not edited:
        return "The model returned no text."

    reference = len(original.strip())
    ceiling = reference * MAX_EDIT_LENGTH_RATIO
    if vision:
        ceiling = max(ceiling, MAX_VISION_EDIT_CHARS)
    if len(edited) > ceiling:
        return "The model returned far more text than the caption it was given."

    if len(edited) < reference * MIN_EDIT_LENGTH_RATIO and len(edited) < MIN_EDITED_CAPTION_CHARS:
        return "The model returned too little text to be the edited caption."

    return None


def list_edit_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_edit_captions_folder(folder: Path, *, instruction: str = "") -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not instruction.strip():
        raise ValueError("Enter an instruction for the edit")

    if not list_edit_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")


def edit_caption(
    client,
    system_prompt: str,
    caption: str,
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    mode: AutomationMode = "instruct",
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    frames: MediaFrames | None = None,
    media_kind: MediaKind = "image",
    attempt: int = 1,
) -> str | None:
    """Text-only unless ``frames`` is given; ``attempt`` only reaches JPEG quality."""
    if frames is not None:
        seconds = frames.timestamps[-1] if frames.timestamps else None
        return request_vision_text(
            client,
            system_prompt,
            frames.images,
            build_edit_user_text(caption, media_kind, len(frames.images), seconds),
            max_pixels=media_kind_max_pixels(media_kind, seconds=seconds),
            mode=mode,
            effort=effort,
            preserve_thinking=preserve_thinking,
            model=model,
            max_tokens=max_tokens,
            timestamps=frames.timestamps,
            attempt=attempt,
        )

    return run_chat_completion(
        client,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": build_edit_user_text(caption)},
        ],
        mode=mode,
        effort=effort,
        preserve_thinking=preserve_thinking,
        model=model,
        max_tokens=max_tokens,
    )


def process_media(
    client,
    media_path: Path,
    system_prompts: dict[MediaKind, str],
    *,
    vision: bool = False,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    should_cancel: ShouldCancel | None = None,
    reference_caption: str | None = None,
) -> tuple[str | None, str, str | None]:
    ref_caption = reference_caption
    if ref_caption is None:
        ref_caption, status, _revision = load_reference_caption(media_path)
        if status != "ok" or ref_caption is None:
            return None, status, None

    media_kind = media_kind_for(media_path)
    frames: MediaFrames | None = None
    if vision:
        loaded = load_media_images(media_path)
        if isinstance(loaded, MediaLoadError):
            return None, loaded.status, loaded.message or "Could not read the media."
        frames = loaded

    def attempt(number: int) -> ModelOutcome[str]:
        raw = edit_caption(
            client,
            system_prompts[media_kind],
            ref_caption,
            model=model,
            mode=mode,
            effort=effort,
            preserve_thinking=preserve_thinking,
            frames=frames,
            media_kind=media_kind,
            attempt=number,
        )
        if raw is None:
            return ModelOutcome(
                status="api_error",
                message="Model request failed or returned no content.",
            )

        edited = clean_edited_caption(raw)
        reason = edit_rejection_reason(ref_caption, edited, vision=vision)
        if reason is not None:
            return ModelOutcome(status=REJECTED, value=edited, message=reason)

        return ModelOutcome(status="success", value=edited)

    outcome = call_with_retries(
        attempt,
        job_label="Edit captions",
        media_name=media_path.name,
        should_cancel=should_cancel,
        on_abandon=lambda: close_model_client(client),
    )
    return outcome.value, outcome.status, outcome.message


def preview_caption_edits(
    folder: Path,
    *,
    instruction: str = "",
    mode: AutomationMode = "instruct",
    reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    vision: bool = False,
    selected_paths: list[Path] | None = None,
) -> EditCaptionsPreviewResponse:
    """Try the job's edit on up to three readable captions without writing sidecars."""
    validate_edit_captions_folder(folder, instruction=instruction)
    media_files = filter_media_list(list_edit_captions_media(folder), selected_paths)
    system_prompts = build_edit_system_prompts(instruction, vision=vision)
    resolved_model = get_openai_model()
    samples: list[CaptionEditPreviewSample] = []

    with model_client() as client:
        # One sample per caption, as the job edits them: a shared caption is edited once.
        for target in caption_targets(media_files):
            media_path = target.primary
            original = load_reference_caption(media_path).text
            if original is None:
                continue
            edited, status, message = process_media(
                client,
                media_path,
                system_prompts,
                vision=vision,
                model=resolved_model,
                mode=mode,
                effort=reasoning_effort,
                preserve_thinking=preserve_thinking,
                reference_caption=original,
            )
            samples.append(
                CaptionEditPreviewSample(
                    name=media_path.name,
                    before=original,
                    after=edited if status == "success" else None,
                    error=None
                    if status == "success"
                    else message or "Could not preview this caption.",
                )
            )
            if len(samples) >= CAPTION_EDIT_PREVIEW_LIMIT:
                break

    return EditCaptionsPreviewResponse(samples=samples)


def _initial_job_stats(total: int) -> dict[str, int]:
    return {
        "total": total,
        "success": 0,
        UNCHANGED: 0,
        REJECTED: 0,
        NO_CAPTION_STATUS: 0,
        "read_error": 0,
        FRAME_ERROR: 0,
        "api_error": 0,
        "write_error": 0,
        CAPTION_CHANGED_STATUS: 0,
        "cancelled": 0,
    }


def run_edit_captions_job(
    folder: Path,
    *,
    instruction: str = "",
    backup: bool = True,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    vision: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_edit_captions_folder(folder, instruction=instruction)

    system_prompts = build_edit_system_prompts(instruction, vision=vision)
    media_files = filter_media_list(list_edit_captions_media(folder), selected_paths)
    resolved_model = model if model is not None else get_openai_model()

    backup_dir = caption_backup_dir(folder)
    if backup:
        try:
            backup_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise ValueError(f"Could not create the .backup folder: {exc}") from exc

    with model_client() as client:

        def process(target: CaptionTarget) -> FileOutcome:
            media_path = target.primary
            # The caption the edit is built from; the write is refused if it changes meanwhile.
            reference = load_reference_caption(media_path)
            draft = reference.text
            if draft is None:
                return FileOutcome.counted(reference.status)
            edited, status, message = process_media(
                client,
                media_path,
                system_prompts,
                vision=vision,
                model=resolved_model,
                mode=mode,
                effort=reasoning_effort,
                preserve_thinking=preserve_thinking,
                should_cancel=should_cancel,
                reference_caption=draft,
            )

            if status == "cancelled":
                return FileOutcome.cancelled()

            if status != "success" or edited is None:
                return FileOutcome.counted(status, message)

            if edited.strip() == draft.strip():
                return FileOutcome.counted(
                    UNCHANGED, message="The edit did not change this caption"
                )

            if should_cancel and should_cancel():
                return FileOutcome.cancelled()

            if backup:
                try:
                    back_up_caption(target.caption, backup_dir)
                except OSError as exc:
                    # Do not write the edit if backup failed; that would break the restore promise.
                    return FileOutcome.counted(
                        "write_error", f"Could not back up the caption: {exc}"
                    )

            try:
                save_caption(media_path, edited, base_revision=reference.revision)
            except CaptionConflictError as exc:
                return FileOutcome.counted(CAPTION_CHANGED_STATUS, f"{exc}; that edit was kept")
            except (OSError, ValueError) as exc:
                return FileOutcome.counted("write_error", exc)

            return FileOutcome.counted("success", description=edited.strip())

        return run_caption_job(
            folder,
            media_files,
            stats=_initial_job_stats(len(media_files)),
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
            processed_stat_keys=PROCESSED_STAT_KEYS,
        )
