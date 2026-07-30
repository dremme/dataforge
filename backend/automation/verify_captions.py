"""Vision-model verify existing captions against their images."""

from __future__ import annotations

import json
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
    close_vision_client,
    load_image_rgb,
    prepare_images_for_api,
    run_vision_completion,
    vision_messages,
)
from captions import (
    NO_CAPTION_STATUS,
    issue_file_path,
    load_reference_caption,
    normalize_issue_fixes,
)
from constants import IMAGE_EXTENSIONS, MAX_ISSUE_FIXES
from openai_settings import create_openai_client, get_max_tokens, get_openai_model

logger = logging.getLogger(__name__)

IMAGE_MAX_PIXELS = 1_750_000

# For now, only images are supported
VERIFY_CAPTIONS_EXTENSIONS = IMAGE_EXTENSIONS

VerifyMode = Literal["thinking", "instruct"]

NON_SUCCESS_STATUSES = frozenset({NO_CAPTION_STATUS, "read_error", "api_error", "parse_error"})

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


def _parse_verification_payload(data: dict) -> VerificationResult | None:
    """Let the verdict gate the fix list.

    Asking for the verdict first buys a cheap commitment token before any fix text is
    generated; without it the model treats the open array as an invitation and flags
    everything. A stated "correct" therefore outranks any fixes that follow it.
    """
    correct = _coerce_bool(data.get("correct"))
    if correct is None:
        return None
    if correct:
        return VerificationResult(fixes=())

    return VerificationResult(fixes=tuple(normalize_issue_fixes(data.get("fixes"))))


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


def build_verification_system_prompt(context: str = "") -> str:
    sections = [
        textwrap.dedent(
            """
            # Role
            You are a caption fact-checker for LoRA training data.
            """
        ).strip(),
        textwrap.dedent(
            """
            # Objective
            Compare the provided image to the proposed caption and judge whether the caption
            accurately describes what is visible. Flag only objective contradictions between
            the caption text and the image.

            Pay special attention to hand and leg positioning, as these are often incorrect
            in captions even when the rest of the description is reasonable.
            """
        ).strip(),
    ]

    context_stripped = context.strip()
    if context_stripped:
        sections.append(f"# Additional context\n{context_stripped}")

    sections.append(
        textwrap.dedent(
            f"""
            # Rules
            - Set "correct" to true when the caption matches the image, including when it omits
              optional details that do not contradict what is visible.
            - Set "correct" to false only for clear factual contradictions (wrong subject, wrong
              clothing, wrong pose, wrong setting, invented details, incorrect hand/leg positioning).
            - When you are unsure, set "correct" to true.
            - Do not flag caption style, formatting, or harmless omissions.

            # Output Format
            Respond exclusively with a valid JSON object (no markdown fences):
            {{
                "correct": true or false,
                "fixes": ["At most {MAX_ISSUE_FIXES} instructions, most important first, each quoting the exact caption phrase that contradicts the image and stating what it should say instead. Empty when correct is true."]
            }}
            """
        ).strip()
    )

    return "\n\n".join(sections)


def build_verification_user_text(ref_caption: str) -> str:
    return textwrap.dedent(
        f"""
        Proposed caption to verify:
        {ref_caption.strip()}

        Compare this caption against the image. Output only the JSON object.
        """
    ).strip()


def list_verify_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, VERIFY_CAPTIONS_EXTENSIONS, order="name")


def _load_image(media_path: Path) -> tuple[list[Image.Image] | None, str | None]:
    images, error = load_image_rgb(media_path)
    if images is None:
        return None, f"read_error: {error}"
    return images, None


def verify_caption(
    client,
    media_path: Path,
    system_prompt: str,
    ref_caption: str,
    *,
    images: list[Image.Image] | None = None,
    model: str | None = None,
    max_tokens: int | None = None,
    mode: VerifyMode = "instruct",
) -> str | None:
    if images is None:
        images, _load_error = _load_image(media_path)
        if images is None:
            return None

    images_b64 = prepare_images_for_api(images, max_pixels=IMAGE_MAX_PIXELS)
    if not images_b64:
        return None

    return run_vision_completion(
        client,
        vision_messages(system_prompt, images_b64, build_verification_user_text(ref_caption)),
        mode=mode,
        model=model if model is not None else get_openai_model(),
        max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
    )


def process_media(
    client,
    media_path: Path,
    system_prompt: str,
    *,
    model: str | None = None,
    mode: VerifyMode = "instruct",
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[Path, VerificationResult | None, str, str | None]:
    resolved_model = model if model is not None else get_openai_model()
    ref_caption, status = load_reference_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None

    images, load_error = _load_image(media_path)
    if load_error:
        return media_path, None, load_error, None

    def attempt() -> ModelOutcome[VerificationResult]:
        raw_caption = verify_caption(
            client,
            media_path,
            system_prompt,
            ref_caption,
            images=images,
            model=resolved_model,
            mode=mode,
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
        raise ValueError("No supported images found in folder")


def _initial_job_stats(total: int) -> dict[str, int]:
    return {
        "total": total,
        "success": 0,
        "issues_found": 0,
        NO_CAPTION_STATUS: 0,
        "read_error": 0,
        "api_error": 0,
        "parse_error": 0,
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


def _failure_outcome(status: str, detail: str | None) -> FileOutcome:
    """Map a non-success ``process_media`` status onto its counter and message."""
    base_status, _, read_detail = status.partition(":")
    message = read_detail.strip() or status if base_status == "read_error" else detail

    return FileOutcome(
        status=base_status,
        stats={base_status: 1} if base_status in NON_SUCCESS_STATUSES else {},
        fields={"message": message} if message else {},
    )


def run_verify_captions_job(
    folder: Path,
    *,
    model: str | None = None,
    mode: VerifyMode = "instruct",
    context: str = "",
    on_progress: ProgressCallback | None = None,
    should_cancel: Callable[[], bool] | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_verify_captions_folder(folder)
    _clear_existing_issue_sidecars(folder)

    system_prompt = build_verification_system_prompt(context)
    media_files = filter_media_list(list_verify_captions_media(folder), selected_paths)
    client = create_openai_client()
    resolved_model = model if model is not None else get_openai_model()

    def process(media_path: Path) -> FileOutcome:
        _path, verification, status, detail = process_media(
            client,
            media_path,
            system_prompt,
            model=resolved_model,
            mode=mode,
            should_cancel=should_cancel,
        )

        if status == "cancelled":
            return FileOutcome(status="cancelled", stats={"cancelled": 1}, stop=True)

        if status != "success" or verification is None:
            return _failure_outcome(status, detail)

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
