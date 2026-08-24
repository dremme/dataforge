"""Rewrite existing captions with the local model, from a user instruction.

The first text-only job: the caption is the entire input and no media is sent, which
makes it far cheaper per file than the captioning jobs. It talks to ``automation.llm``
directly rather than through ``automation.vision`` — the model is multi-modal and
describes an image only when given one, so a request with no media in it is simply a
text request.
"""

from __future__ import annotations

import logging
import shutil
import textwrap
from collections.abc import Callable
from pathlib import Path

from automation.backup_captions import caption_backup_dir, caption_sidecars
from automation.job_runner import FileOutcome, run_media_job
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
from captions import NO_CAPTION_STATUS, load_reference_caption, save_caption
from constants import MEDIA_EXTENSIONS
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    get_max_tokens,
    get_openai_model,
)
from schemas import AutomationMode

logger = logging.getLogger(__name__)

EDIT_CAPTIONS_EXTENSIONS = MEDIA_EXTENSIONS

REJECTED = "rejected"
UNCHANGED = "unchanged"

NON_SUCCESS_STATUSES = frozenset({NO_CAPTION_STATUS, "read_error", "api_error", REJECTED})

#: Every file is handled exactly once, so all of these count toward ``processed``;
#: leaving any out would stop the progress bar short of ``total``.
PROCESSED_STAT_KEYS = (
    "success",
    UNCHANGED,
    REJECTED,
    NO_CAPTION_STATUS,
    "read_error",
    "api_error",
    "write_error",
)

#: How far an edit may move a caption's length before the reply is treated as something
#: other than an edited caption. Ratios against the original's stripped length.
MIN_EDIT_LENGTH_RATIO = 0.25
MAX_EDIT_LENGTH_RATIO = 4.0

#: A reply at least this long is a caption whatever the ratio says, so an instruction that
#: deliberately collapses a long caption ("shorten to one sentence") is not rejected for
#: succeeding. Deliberately not ``DRAFT_CAPTION_THRESHOLD``: that gate asks "is this a
#: finished LoRA caption", and this job exists partly to fall below it on purpose.
MIN_EDITED_CAPTION_CHARS = 40

_QUOTE_PAIRS = (('"', '"'), ("'", "'"), ("“", "”"))

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]


def build_edit_system_prompt(instruction: str) -> str:
    """Assemble the system prompt for one run.

    Built once per job, not once per file, so the system message is byte-identical
    across the whole folder and the server's prompt-prefix cache stays warm.
    """
    sections = [
        textwrap.dedent(
            """
            # Role
            You are a caption editor for LoRA training data.
            """
        ).strip(),
        textwrap.dedent(
            """
            # Objective
            Rewrite the caption you are given so that it satisfies the requested edit, and
            return the rewritten caption. The caption text is all you are given.
            """
        ).strip(),
        f"# Edit to apply\n{instruction.strip()}",
        # Four rules, all about judging what to change. Output mechanics belong in the
        # output format below: growing this list with them regressed verify-captions
        # badly enough to be worth remembering here.
        textwrap.dedent(
            """
            # Rules
            - Make the requested edit and change nothing else.
            - Keep every detail the caption already states, unless the edit is to remove it.
            - Add nothing the caption does not already state.
            - When the edit does not apply to this caption, return the caption unchanged.
            """
        ).strip(),
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


def build_edit_user_text(caption: str) -> str:
    """The per-file turn: the caption, then a restatement of what to do with it.

    The caption is unfenced because fencing the input invites a fenced answer, and the
    instruction is referenced rather than repeated so the two copies cannot drift.
    """
    return (
        f"Caption to edit:\n{caption.strip()}\n\n"
        "Apply the edit from the system instructions to this caption. "
        "Output only the edited caption."
    )


def strip_wrapping_quotes(text: str) -> str:
    """Drop one pair of wrapping quotes, keeping a caption that is itself a quotation.

    "Return only the caption" reliably provokes a quoted reply, and no prefix rule can
    catch it. The interior check is what stops this eating the quotes off a caption
    whose whole content is one quoted phrase.
    """
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


def edit_rejection_reason(original: str, edited: str) -> str | None:
    """Why this reply is not an edited caption, or ``None`` when it is.

    The bounds are asymmetric on purpose. A bare ratio floor would reject "shorten to
    one sentence" for working, so a reply that still reads as a caption on its own is
    kept however far it fell. There is no matching allowance on the long side: writing
    new material from the media is auto-caption's job, and nothing here has the media
    to write it from, so a caption that quadrupled was invented.
    """
    edited = edited.strip()
    if not edited:
        return "The model returned no text."

    reference = len(original.strip())
    if len(edited) > reference * MAX_EDIT_LENGTH_RATIO:
        return "The model returned far more text than the caption it was given."

    if len(edited) < reference * MIN_EDIT_LENGTH_RATIO and len(edited) < MIN_EDITED_CAPTION_CHARS:
        return "The model returned too little text to be the edited caption."

    return None


def list_edit_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, EDIT_CAPTIONS_EXTENSIONS, order="name")


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
) -> str | None:
    """Ask the model for the edited caption, or ``None`` when the request fails.

    The user content is a bare string rather than a parts list: parts exist to carry
    media, and there is none here.
    """
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
        max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
    )


def process_media(
    client,
    media_path: Path,
    system_prompt: str,
    *,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[Path, str | None, str, str | None]:
    """Read one caption, edit it, and report ``(path, edited, status, message)``."""
    resolved_model = model if model is not None else get_openai_model()
    ref_caption, status = load_reference_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None

    def attempt(_number: int) -> ModelOutcome[str]:
        # The attempt number exists for the frame re-encode workaround in ``vision``;
        # a text request sends the same bytes every time, so it is ignored here.
        raw = edit_caption(
            client,
            system_prompt,
            ref_caption,
            model=resolved_model,
            mode=mode,
            effort=effort,
            preserve_thinking=preserve_thinking,
        )
        if raw is None:
            return ModelOutcome(
                status="api_error",
                message="Model request failed or returned no content.",
            )

        edited = clean_edited_caption(raw)
        reason = edit_rejection_reason(ref_caption, edited)
        if reason is not None:
            # Non-success, so this retries: a leaked preamble is often a one-off.
            return ModelOutcome(status=REJECTED, value=edited, message=reason)

        return ModelOutcome(status="success", value=edited)

    outcome = call_with_retries(
        attempt,
        job_label="Edit captions",
        media_name=media_path.name,
        should_cancel=should_cancel,
        on_abandon=lambda: close_model_client(client),
    )
    return media_path, outcome.value, outcome.status, outcome.message


def back_up_caption_sidecars(media_path: Path, backup_dir: Path) -> None:
    """Copy this file's sidecars into ``backup_dir``, keeping any copy already there.

    Keeping the existing copy is what makes a second run safe: the backup stays the
    caption as it was before the *first* edit, which is the one worth restoring.
    """
    for sidecar in caption_sidecars(media_path):
        target = backup_dir / sidecar.name
        if not target.exists():
            shutil.copy2(sidecar, target)


def _initial_job_stats(total: int) -> dict[str, int]:
    return {
        "total": total,
        "success": 0,
        UNCHANGED: 0,
        REJECTED: 0,
        NO_CAPTION_STATUS: 0,
        "read_error": 0,
        "api_error": 0,
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


def run_edit_captions_job(
    folder: Path,
    *,
    instruction: str = "",
    backup: bool = True,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_edit_captions_folder(folder, instruction=instruction)

    system_prompt = build_edit_system_prompt(instruction)
    media_files = filter_media_list(list_edit_captions_media(folder), selected_paths)
    resolved_model = model if model is not None else get_openai_model()

    backup_dir = caption_backup_dir(folder)
    if backup:
        # A folder that cannot hold the backups is a whole-run problem, not a per-file one.
        try:
            backup_dir.mkdir(exist_ok=True)
        except OSError as exc:
            raise ValueError(f"Could not create the .backup folder: {exc}") from exc

    with model_client() as client:

        def process(media_path: Path) -> FileOutcome:
            _path, edited, status, message = process_media(
                client,
                media_path,
                system_prompt,
                model=resolved_model,
                mode=mode,
                effort=reasoning_effort,
                preserve_thinking=preserve_thinking,
                should_cancel=should_cancel,
            )

            if status == "cancelled":
                return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

            if status != "success" or edited is None:
                return _failure_outcome(status, message)

            original, _status = load_reference_caption(media_path)
            if original is not None and edited.strip() == original.strip():
                # Nothing to write, so nothing to back up either.
                return FileOutcome(
                    status=UNCHANGED,
                    stats={UNCHANGED: 1},
                    fields={"message": "The edit did not change this caption"},
                )

            if should_cancel and should_cancel():
                # Do not touch the folder when cancellation landed around this file.
                return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

            if backup:
                try:
                    back_up_caption_sidecars(media_path, backup_dir)
                except OSError as exc:
                    # Writing the edit now would break the promise the backup exists to
                    # make, so the caption is left alone and the run moves on.
                    return FileOutcome(
                        status="write_error",
                        stats={"write_error": 1},
                        fields={"message": f"Could not back up the caption: {exc}"},
                    )

            try:
                save_caption(media_path, edited)
            except (OSError, ValueError) as exc:
                return FileOutcome(
                    status="write_error",
                    stats={"write_error": 1},
                    fields={"message": str(exc)},
                )

            return FileOutcome(
                status="success",
                stats={"success": 1},
                fields={"description": edited.strip()},
            )

        return run_media_job(
            folder,
            media_files,
            stats=_initial_job_stats(len(media_files)),
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
            processed_stat_keys=PROCESSED_STAT_KEYS,
        )
