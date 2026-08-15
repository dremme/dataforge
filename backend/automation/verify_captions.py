"""Vision-model verify existing captions against their media."""

from __future__ import annotations

import json
import logging
import re
import textwrap
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.vision import (
    MediaKind,
    ModelOutcome,
    call_with_retries,
    clean_model_text,
    close_vision_client,
    get_video_frame_max_pixels,
    keyframe_sentence,
    load_media_images,
    media_kind_for,
    request_vision_text,
    vision_client,
)
from captions import (
    NO_CAPTION_STATUS,
    issue_file_path,
    load_reference_caption,
    normalize_issue_fixes,
)
from constants import IMAGE_EXTENSIONS, MAX_ISSUE_FIXES, MOTION_EXTENSIONS
from openai_settings import (
    DEFAULT_PRESERVE_THINKING,
    DEFAULT_REASONING_EFFORT,
    get_openai_model,
)
from schemas import AutomationMode

logger = logging.getLogger(__name__)

IMAGE_MAX_PIXELS = 1_750_000


def media_kind_max_pixels(media_kind: MediaKind) -> int:
    """Per-frame pixel budget, larger for stills here than in auto-caption.

    Fact-checking needs more detail - a hand position is decided by a small part of the
    frame. Keyframes keep the shared motion budget, resolved per call because it is
    configurable.
    """
    return IMAGE_MAX_PIXELS if media_kind == "image" else get_video_frame_max_pixels()


VERIFY_CAPTIONS_EXTENSIONS = IMAGE_EXTENSIONS | MOTION_EXTENSIONS


NON_SUCCESS_STATUSES = frozenset(
    {NO_CAPTION_STATUS, "read_error", "api_error", "parse_error", "frame_error"}
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]


@dataclass(frozen=True)
class VerificationResult:
    fixes: tuple[str, ...]


def _strip_json_fences(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped

    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_json_object(text: str) -> dict | None:
    start = 0
    while start < len(text):
        start = text.find("{", start)
        if start < 0:
            return None

        depth = 0
        for index in range(start, len(text)):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[start : index + 1]
                    try:
                        data = json.loads(candidate)
                    except json.JSONDecodeError:
                        break
                    if isinstance(data, dict):
                        return data
                    break
        start += 1

    return None


def _response_preview(raw: str, *, limit: int = 160) -> str:
    compact = " ".join(raw.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: limit - 3]}..."


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "yes"}:
            return True
        if normalized in {"false", "no"}:
            return False
    return None


def _has_substantive_issues(issues: str) -> bool:
    return issues.strip().lower() not in {"", "none", "n/a"}


_ENUMERATION_MARKER = re.compile(r"^\s*(?:[-*]|\d+[.)])\s+")
# "1." is indistinguishable from a sentence end, so it splits off on its own.
_MARKER_ONLY = re.compile(r"^\s*(?:[-*]|\d+[.)])\s*$")
# No semicolon: Qwen uses it to continue one finding, so splitting there fragments it.
_SENTENCE_TERMINATORS = frozenset(".!?")


def _ends_sentence(text: str, index: int) -> bool:
    """Whether the terminator at ``index`` closes a sentence rather than sitting inside one.

    Qwen shortens sentences with an ellipsis mid-thought ("the arm is raised... not
    lowered"), so the closing dot of a run of dots continues the sentence. Otherwise a
    terminator ends one only at the end of the text or before whitespace, which also
    keeps decimals like "5.5 inch" together.
    """
    if text[index] == "." and index > 0 and text[index - 1] == ".":
        return False

    next_char = text[index + 1 : index + 2]
    return not next_char or next_char.isspace()


def split_fix_sentences(text: str) -> list[str]:
    """Split prose into sentences, treating double-quoted spans as atomic.

    The model quotes caption phrases verbatim, so a terminator inside quotes
    (``Replace "a blue car." with ...``) must not split.
    """
    sentences: list[str] = []
    start = 0
    in_quote = False
    for index, char in enumerate(text):
        if char == '"':
            in_quote = not in_quote
        elif char in _SENTENCE_TERMINATORS and not in_quote and _ends_sentence(text, index):
            sentences.append(text[start : index + 1])
            start = index + 1

    sentences.append(text[start:])
    cleaned = (
        _ENUMERATION_MARKER.sub("", sentence).strip()
        for sentence in sentences
        if not _MARKER_ONLY.match(sentence)
    )
    return [sentence for sentence in cleaned if sentence]


def _parse_verification_payload(data: dict) -> VerificationResult | None:
    """Let the verdict gate the issue prose.

    Asking for the verdict first buys a cheap commitment token before any issue text is
    generated; without it the model flags everything. The issues come back as prose rather
    than an array because short units are cheap to enumerate: an array element, and equally
    a terse "Replace X with Y.", invites another one. Pushing this field toward imperative
    phrasing was measured at 2.3 findings per caption against 1.3 for descriptive prose,
    so the wording here is deliberately declarative.
    """
    correct = _coerce_bool(data.get("correct"))
    issues = data.get("issues")
    if correct is None or not isinstance(issues, str):
        return None
    if correct or not _has_substantive_issues(issues):
        return VerificationResult(fixes=())

    return VerificationResult(fixes=tuple(normalize_issue_fixes(split_fix_sentences(issues))))


def parse_verification_response(raw_text: str) -> VerificationResult | None:
    text = _strip_json_fences(clean_model_text(raw_text))
    data: dict | None = None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            data = parsed
    except json.JSONDecodeError:
        data = _extract_json_object(text)

    if data is None:
        return None

    return _parse_verification_payload(data)


def should_write_issue_file(verification: VerificationResult) -> bool:
    return bool(verification.fixes)


def verification_result_to_dict(verification: VerificationResult) -> dict[str, object]:
    return {"fixes": list(verification.fixes)}


@dataclass(frozen=True)
class MediaKindWording:
    """The per-kind words the rules and output format are written around.

    ``framing`` opens the objective; the rest slot into sentences that are otherwise
    identical for stills and motion, so the two prompts stay calibrated together.
    """

    framing: str
    subject: str
    visible_ref: str
    contradict_ref: str


# Kept out of ``framing`` because it applies to both kinds: the pose errors it targets
# are the ones the model misses regardless of how many frames it is looking at.
_POSITIONING_ATTENTION = textwrap.dedent(
    """
    Pay special attention to hand and leg positioning, as these are often incorrect
    in captions even when the rest of the description is reasonable.
    """
).strip()

MEDIA_KIND_WORDING: dict[MediaKind, MediaKindWording] = {
    "image": MediaKindWording(
        framing=textwrap.dedent(
            """
            Compare the provided image to the proposed caption and judge whether the caption
            accurately describes what is visible. Flag only objective contradictions between
            the caption text and the image.
            """
        ).strip(),
        subject="image",
        visible_ref="what is visible",
        contradict_ref="the image",
    ),
    "video": MediaKindWording(
        framing=textwrap.dedent(
            """
            You are given keyframes extracted evenly across the video timeline, presented in
            chronological order. Treat them as a single continuous video. Compare them to the
            proposed caption and judge whether the caption accurately describes what is visible
            across the sequence. Flag only objective contradictions between the caption text
            and the video.
            """
        ).strip(),
        subject="video",
        visible_ref="what is visible across the keyframes",
        contradict_ref="the video",
    ),
}


def build_verification_system_prompt(
    context: str = "",
    *,
    media_kind: MediaKind = "image",
) -> str:
    wording = MEDIA_KIND_WORDING[media_kind]
    subject = wording.subject
    visible_ref = wording.visible_ref
    contradict_ref = wording.contradict_ref

    sections = [
        textwrap.dedent(
            """
            # Role
            You are a caption fact-checker for LoRA training data.
            """
        ).strip(),
        f"# Objective\n{wording.framing}\n\n{_POSITIONING_ATTENTION}",
    ]

    context_stripped = context.strip()
    if context_stripped:
        sections.append(f"# Additional context\n{context_stripped}")

    sections.append(
        textwrap.dedent(
            f"""
            # Rules
            - Set "correct" to true when the caption matches the {subject}, including when it omits
              optional details that do not contradict {visible_ref}.
            - Set "correct" to false only for clear factual contradictions (wrong subject, wrong
              clothing, wrong pose, wrong setting, invented details, incorrect hand/leg positioning).
            - When you are unsure, set "correct" to true.
            - Do not flag caption style, formatting, or harmless omissions.
            - When "correct" is false, quote the exact caption phrase that contradicts {contradict_ref}
              in "issues".

            # Output Format
            Respond exclusively with a valid JSON object (no markdown fences):
            ```json
            {{
                "correct": true or false,
                "issues": "Up to {MAX_ISSUE_FIXES} sentences, most important first, each quoting the exact caption phrase that contradicts {contradict_ref} and stating what it should say instead, or 'None'."
            }}
            ```

            ## Important Output Rule
            Each issue is a single sentence. Everything about one contradiction stays inside
            that one sentence, the quoted caption phrase and what it should say instead joined
            with a comma or a semicolon; a new sentence is read as a separate issue.
            """
        ).strip()
    )

    return "\n\n".join(sections)


def build_verification_system_prompts(context: str = "") -> dict[MediaKind, str]:
    return {
        kind: build_verification_system_prompt(context, media_kind=kind)
        for kind in MEDIA_KIND_WORDING
    }


def build_verification_user_text(
    ref_caption: str,
    media_kind: MediaKind = "image",
    frame_count: int = 1,
    seconds: float | None = None,
) -> str:
    if media_kind == "video":
        return textwrap.dedent(
            f"""
            Proposed caption to verify:
            {ref_caption.strip()}

            {keyframe_sentence(frame_count, seconds)}
            Compare this caption against the video keyframes. Output only the JSON object.
            """
        ).strip()

    return textwrap.dedent(
        f"""
        Proposed caption to verify:
        {ref_caption.strip()}

        Compare this caption against the image. Output only the JSON object.
        """
    ).strip()


def list_verify_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, VERIFY_CAPTIONS_EXTENSIONS, order="name")


def verify_caption(
    client,
    media_path: Path,
    system_prompt: str,
    ref_caption: str,
    *,
    images: list[Image.Image],
    model: str | None = None,
    max_tokens: int | None = None,
    mode: AutomationMode = "instruct",
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    timestamps: list[float] | None = None,
) -> str | None:
    """Ask the model to fact-check ``ref_caption`` against already-loaded ``images``.

    Decoding stays with ``process_media`` so a file that never opened is reported as
    such instead of being retried three times as a model failure. ``timestamps``
    follows the same rule: resolved once by the caller, sent again on every retry.
    """
    media_kind = media_kind_for(media_path)
    return request_vision_text(
        client,
        system_prompt,
        images,
        build_verification_user_text(
            ref_caption,
            media_kind,
            len(images),
            timestamps[-1] if timestamps else None,
        ),
        max_pixels=media_kind_max_pixels(media_kind),
        mode=mode,
        effort=effort,
        preserve_thinking=preserve_thinking,
        model=model,
        max_tokens=max_tokens,
        timestamps=timestamps,
    )


def process_media(
    client,
    media_path: Path,
    system_prompts: dict[MediaKind, str],
    *,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[Path, VerificationResult | None, str, str | None]:
    resolved_model = model if model is not None else get_openai_model()
    ref_caption, status = load_reference_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None

    media_kind = media_kind_for(media_path)
    frames, load_error = load_media_images(media_path)
    if load_error is not None:
        return media_path, None, load_error.status, load_error.message

    system_prompt = system_prompts[media_kind]

    def attempt() -> ModelOutcome[VerificationResult]:
        raw_caption = verify_caption(
            client,
            media_path,
            system_prompt,
            ref_caption,
            images=frames.images,
            model=resolved_model,
            mode=mode,
            effort=effort,
            preserve_thinking=preserve_thinking,
            timestamps=frames.timestamps,
        )
        if raw_caption is None:
            return ModelOutcome(
                status="api_error",
                message="Model request failed or returned no content.",
            )

        verification = parse_verification_response(raw_caption)
        if verification is None:
            return ModelOutcome(
                status="parse_error",
                message=f"Model response was not valid JSON: {_response_preview(raw_caption)}",
            )

        return ModelOutcome(status="success", value=verification)

    outcome = call_with_retries(
        attempt,
        job_label="Verify captions",
        media_name=media_path.name,
        should_cancel=should_cancel,
        on_abandon=lambda: close_vision_client(client),
    )
    return media_path, outcome.value, outcome.status, outcome.message


def validate_verify_captions_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_verify_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")


def _initial_job_stats(total: int) -> dict[str, int]:
    return {
        "total": total,
        "success": 0,
        "issues_found": 0,
        NO_CAPTION_STATUS: 0,
        "read_error": 0,
        "api_error": 0,
        "parse_error": 0,
        "frame_error": 0,
        "write_error": 0,
        "cancelled": 0,
    }


def _clear_existing_issue_sidecars(folder: Path) -> None:
    try:
        issue_files = sorted(folder.glob("*.issue.json"), key=lambda path: path.name.lower())
    except OSError:
        return

    for issue_path in issue_files:
        try:
            if not issue_path.is_file():
                continue
            issue_path.unlink()
        except OSError as exc:
            logger.warning("Failed to remove issue sidecar %s: %s", issue_path.name, exc)


def _remove_stale_issue_file(media_path: Path) -> None:
    issue_path = issue_file_path(media_path)
    if not issue_path.is_file():
        return
    try:
        issue_path.unlink()
    except OSError as exc:
        logger.warning("Failed to remove stale issue file %s: %s", issue_path.name, exc)


def _failure_outcome(status: str, message: str | None) -> FileOutcome:
    """Map a non-success ``process_media`` status onto its counter and message."""
    return FileOutcome(
        status=status,
        stats={status: 1} if status in NON_SUCCESS_STATUSES else {},
        fields={"message": message} if message else {},
    )


def run_verify_captions_job(
    folder: Path,
    *,
    model: str | None = None,
    mode: AutomationMode = "instruct",
    reasoning_effort: str = DEFAULT_REASONING_EFFORT,
    preserve_thinking: bool = DEFAULT_PRESERVE_THINKING,
    context: str = "",
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_verify_captions_folder(folder)
    _clear_existing_issue_sidecars(folder)

    system_prompts = build_verification_system_prompts(context)
    media_files = filter_media_list(list_verify_captions_media(folder), selected_paths)
    resolved_model = model if model is not None else get_openai_model()

    with vision_client() as client:

        def process(media_path: Path) -> FileOutcome:
            _path, verification, status, message = process_media(
                client,
                media_path,
                system_prompts,
                model=resolved_model,
                mode=mode,
                effort=reasoning_effort,
                preserve_thinking=preserve_thinking,
                should_cancel=should_cancel,
            )

            if status == "cancelled":
                return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

            if status != "success" or verification is None:
                return _failure_outcome(status, message)

            if should_cancel and should_cancel():
                # Do not write the sidecar when cancellation landed around this file.
                return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

            if not should_write_issue_file(verification):
                _remove_stale_issue_file(media_path)
                return FileOutcome(status="success", stats={"success": 1})

            try:
                issue_file_path(media_path).write_text(
                    json.dumps(verification_result_to_dict(verification), indent=2) + "\n",
                    encoding="utf-8",
                )
            except OSError as exc:
                return FileOutcome(
                    status="write_error",
                    stats={"write_error": 1},
                    fields={"message": str(exc)},
                )

            return FileOutcome(
                status="success",
                stats={"issues_found": 1, "success": 1},
                fields={"description": "; ".join(verification.fixes)},
            )

        # ``processed`` counts each handled file once: issues_found is a sub-stat of
        # successful verifications and must not inflate it.
        return run_media_job(
            folder,
            media_files,
            stats=_initial_job_stats(len(media_files)),
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
        )
