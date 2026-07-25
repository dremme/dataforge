"""Vision-model verify existing captions against their images."""

from __future__ import annotations

import base64
import json
import logging
import textwrap
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

from PIL import Image

from captions import issue_file_path
from constants import IMAGE_EXTENSIONS
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

logger = logging.getLogger(__name__)

IMAGE_MAX_PIXELS = 1_750_000
MAX_MODEL_ATTEMPTS = 3

# Used as a trailing assistant prefill for "instruct" (non-thinking) mode on Qwen3 hybrid models.
# Signals that any thinking phase is complete/empty so the model emits the final answer directly.
INSTRUCT_THINK_PREFILL = "<think>\n\n</think>"

# For now, only images are supported
VERIFY_CAPTIONS_EXTENSIONS = IMAGE_EXTENSIONS

VerifyMode = Literal["thinking", "instruct"]

NON_SUCCESS_STATUSES = frozenset({"no_txt", "read_error", "api_error", "parse_error"})

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]


@dataclass(frozen=True)
class VerificationResult:
    correct: bool
    issues: str
    suggestions: str


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


def _parse_verification_payload(data: dict) -> VerificationResult | None:
    correct = _coerce_bool(data.get("correct"))
    issues = data.get("issues")
    suggestions = data.get("suggestions")

    if correct is None:
        return None
    if not isinstance(issues, str) or not isinstance(suggestions, str):
        return None

    return VerificationResult(
        correct=correct,
        issues=issues.strip(),
        suggestions=suggestions.strip(),
    )


def parse_verification_response(raw_text: str) -> VerificationResult | None:
    text = _strip_json_fences(clean_caption(raw_text))
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
    return not verification.correct and _has_substantive_issues(verification.issues)


def verification_result_to_dict(verification: VerificationResult) -> dict[str, object]:
    return {
        "correct": verification.correct,
        "issues": verification.issues,
        "suggestions": verification.suggestions,
    }


def normalize_verification_result(verification: VerificationResult) -> VerificationResult:
    if verification.correct:
        return verification

    if not _has_substantive_issues(verification.issues):
        return VerificationResult(correct=True, issues="None", suggestions="None")

    return verification


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
            """
            # Rules
            - Set "correct" to true when the caption matches the image, including when it omits
              optional details that do not contradict what is visible.
            - Set "correct" to false only for clear factual contradictions (wrong subject, wrong
              clothing, wrong pose, wrong setting, invented details, incorrect hand/leg positioning).
            - Do not flag caption style, formatting, or harmless omissions.
            - When "correct" is false, quote the exact caption phrase that contradicts the image
              in "issues".

            # Output Format
            Respond exclusively with a valid JSON object (no markdown fences):
            {
                "correct": true or false,
                "issues": "Specific contradictions with quoted caption phrases, or 'None'.",
                "suggestions": "Brief fix when correct is false, or 'None'."
            }
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
    media_files: list[Path] = []
    try:
        entries = sorted(folder.iterdir(), key=lambda path: path.name.lower())
    except OSError:
        return []

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.suffix.lower() not in VERIFY_CAPTIONS_EXTENSIONS:
            continue

        media_files.append(entry)

    return media_files


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


def _load_image(media_path: Path) -> tuple[list[Image.Image] | None, str | None]:
    try:
        return [Image.open(media_path).convert("RGB")], None
    except Exception as exc:
        logger.error("Image read error for %s: %s", media_path.name, exc)
        return None, f"read_error: {exc}"


def _run_chat_completion(
    client,
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    mode: VerifyMode,
) -> str | None:
    resolved_model = model if model is not None else get_openai_model()
    resolved_max_tokens = max_tokens if max_tokens is not None else get_max_tokens()
    if mode == "instruct":
        temperature = get_instruct_temperature()
        presence_penalty = get_instruct_presence_penalty()
        top_p = get_instruct_top_p()
        extra_body: dict[str, object] = {
            "top_k": get_top_k(),
            "chat_template_kwargs": {"enable_thinking": False},
        }
        outbound_messages = [*messages, {"role": "assistant", "content": INSTRUCT_THINK_PREFILL}]
    elif mode == "thinking":
        temperature = get_thinking_temperature()
        presence_penalty = get_thinking_presence_penalty()
        top_p = get_thinking_top_p()
        extra_body = {"top_k": get_top_k()}
        outbound_messages = messages
    else:
        return None

    try:
        response = client.chat.completions.create(
            model=resolved_model,
            messages=outbound_messages,
            max_tokens=resolved_max_tokens,
            temperature=temperature,
            top_p=top_p,
            presence_penalty=presence_penalty,
            extra_body=extra_body,
        )
        raw = (response.choices[0].message.content or "").strip()
        return raw if raw else None
    except Exception as exc:
        logger.error("API completion error: %s", exc)
        return None


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

    messages = _vision_messages(
        system_prompt,
        images_b64,
        build_verification_user_text(ref_caption),
    )
    return _run_chat_completion(
        client,
        messages,
        model=model if model is not None else get_openai_model(),
        max_tokens=max_tokens if max_tokens is not None else get_max_tokens(),
        mode=mode,
    )


def _read_caption(media_path: Path) -> tuple[str | None, str]:
    txt_path = media_path.with_suffix(".txt")

    if not txt_path.exists():
        return None, "no_txt"

    try:
        ref_caption = txt_path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        return None, f"read_error: {exc}"

    return ref_caption, "ok"


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
    ref_caption, status = _read_caption(media_path)
    if status != "ok" or ref_caption is None:
        return media_path, None, status, None

    images, load_error = _load_image(media_path)
    if load_error:
        return media_path, None, load_error, None

    last_status = "api_error"
    last_message: str | None = "Model request failed or returned no content."

    for attempt in range(1, MAX_MODEL_ATTEMPTS + 1):
        if should_cancel and should_cancel():
            return media_path, None, "cancelled", None

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
            last_status = "api_error"
            last_message = "Model request failed or returned no content."
        else:
            if should_cancel and should_cancel():
                return media_path, None, "cancelled", None

            verification = parse_verification_response(raw_caption)
            if verification is not None:
                normalized = normalize_verification_result(verification)
                return media_path, normalized, "success", None

            last_status = "parse_error"
            last_message = f"Model response was not valid JSON: {_response_preview(raw_caption)}"

        if attempt < MAX_MODEL_ATTEMPTS:
            logger.warning(
                "Verify captions attempt %s/%s failed for %s (%s); retrying",
                attempt,
                MAX_MODEL_ATTEMPTS,
                media_path.name,
                last_status,
            )

    return media_path, None, last_status, last_message


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
        "no_txt": 0,
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
    from automation.selection import filter_media_list

    validate_verify_captions_folder(folder)
    _clear_existing_issue_sidecars(folder)

    system_prompt = build_verification_system_prompt(context)
    media_files = filter_media_list(list_verify_captions_media(folder), selected_paths)
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

        media_path, verification, status, detail = process_media(
            client,
            media_path,
            system_prompt,
            model=resolved_model,
            mode=mode,
            should_cancel=should_cancel,
        )

        result: dict[str, object] = {
            "path": str(media_path),
            "name": media_path.name,
            "status": status.split(":", 1)[0],
        }

        if status == "success" and verification is not None:
            if should_cancel and should_cancel():
                stats["cancelled"] += 1
                result["status"] = "cancelled"
                # Do not write sidecar if cancellation was requested around this file's processing.
            elif should_write_issue_file(verification):
                issue_path = issue_file_path(media_path)
                try:
                    issue_path.write_text(
                        json.dumps(verification_result_to_dict(verification), indent=2) + "\n",
                        encoding="utf-8",
                    )
                    stats["issues_found"] += 1
                    stats["success"] += 1
                    result["description"] = verification.issues
                    result["preview"] = verification.suggestions
                except OSError as exc:
                    stats["write_error"] += 1
                    result["status"] = "write_error"
                    result["message"] = str(exc)
            else:
                _remove_stale_issue_file(media_path)
                stats["success"] += 1
                result["description"] = verification.issues or None
        elif status == "cancelled":
            stats["cancelled"] += 1
            result["status"] = "cancelled"
        else:
            _record_result_status(stats, result, status)
            if detail and "message" not in result:
                result["message"] = detail

        file_results.append(result)

        if on_progress:
            on_progress(str(media_path), media_path.name, index, total, dict(stats))

        if status == "cancelled":
            # Abort further files; account for any not-yet-processed remaining ones.
            remaining_after_current = total - index
            if remaining_after_current > 0:
                stats["cancelled"] += remaining_after_current
            break

    # Each handled file is counted once in file_results. issues_found is a
    # sub-stat of successful verifications and must not inflate processed.
    processed = len(file_results)

    return {
        "folder": str(folder),
        "total": stats["total"],
        "processed": processed,
        "stats": stats,
        "results": file_results,
    }
