"""Utility job to edit existing captions in bulk: find and replace, prepend, or append text."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_media_job
from automation.selection import filter_media_list, list_folder_media
from captions import CAPTION_READ_ERROR, load_reference_caption, save_caption
from constants import MEDIA_EXTENSIONS

REPLACE_MODES = ("replace", "prepend", "append")

DEFAULT_MODE = "replace"

CaptionReplacer = Callable[[str], str | None]

# $$ first so $$1 stays the characters $1 rather than group 1.
_DOLLAR_REPL = re.compile(r"\$(\$|\d{1,2})")


def _python_replacement(template: str) -> str:
    def expand(match: re.Match[str]) -> str:
        token = match.group(1)
        if token == "$":
            return "$"
        return rf"\g<{int(token)}>"

    return _DOLLAR_REPL.sub(expand, template)


def build_caption_replacer(
    *,
    mode: str = DEFAULT_MODE,
    search: str = "",
    replacement: str = "",
    use_regex: bool = False,
    case_sensitive: bool = False,
) -> CaptionReplacer:
    """Compile one reusable edit shared by the job and its preview; raises ``ValueError`` if unusable."""
    if mode not in REPLACE_MODES:
        raise ValueError(f"Unknown replace mode: {mode}")

    if mode == "replace":
        return _build_replacer(
            search=search,
            replacement=replacement,
            use_regex=use_regex,
            case_sensitive=case_sensitive,
        )

    return _build_affixer(mode=mode, addition=replacement, case_sensitive=case_sensitive)


def _build_replacer(
    *,
    search: str,
    replacement: str,
    use_regex: bool,
    case_sensitive: bool,
) -> CaptionReplacer:
    if not search:
        raise ValueError("Enter the text to search for")

    flags = 0 if case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(search if use_regex else re.escape(search), flags)
    except re.error as exc:
        raise ValueError(f"Invalid regular expression: {exc}") from exc

    template = _python_replacement(replacement) if use_regex else replacement

    def replace(text: str) -> str | None:
        try:
            edited = pattern.sub(template, text)
        except re.error as exc:
            # Group refs like ``\9`` are only resolved against a real match, not at compile time.
            raise ValueError(f"Invalid replacement text: {exc}") from exc
        return _changed(text, edited)

    return replace


def _build_affixer(*, mode: str, addition: str, case_sensitive: bool) -> CaptionReplacer:
    # ``save_caption`` strips, so adding only whitespace is a no-op.
    trimmed = addition.strip()
    if not trimmed:
        raise ValueError("Enter the text to add")

    needle = trimmed if case_sensitive else trimmed.lower()

    def affix(text: str) -> str | None:
        haystack = text if case_sensitive else text.lower()
        if mode == "prepend":
            if haystack.startswith(needle):
                return None
            return _changed(text, f"{addition}{text}")

        if haystack.endswith(needle):
            return None
        return _changed(text, f"{text}{addition}")

    return affix


def _changed(original: str, edited: str) -> str | None:
    """The edited caption, or None when saving it would not change the sidecar."""
    return edited if edited.strip() != original.strip() else None


def list_replace_captions_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_replace_captions_folder(
    folder: Path,
    *,
    mode: str = DEFAULT_MODE,
    search: str = "",
    replacement: str = "",
    use_regex: bool = False,
    case_sensitive: bool = False,
) -> CaptionReplacer:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_replace_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")

    return build_caption_replacer(
        mode=mode,
        search=search,
        replacement=replacement,
        use_regex=use_regex,
        case_sensitive=case_sensitive,
    )


def preview_caption_replacements(
    folder: Path,
    *,
    mode: str = DEFAULT_MODE,
    search: str = "",
    replacement: str = "",
    use_regex: bool = False,
    case_sensitive: bool = False,
    selected_paths: list[Path] | None = None,
    sample_limit: int = 3,
) -> dict[str, object]:
    """Count the captions this edit would change, with a few before/after samples."""
    replacer = build_caption_replacer(
        mode=mode,
        search=search,
        replacement=replacement,
        use_regex=use_regex,
        case_sensitive=case_sensitive,
    )

    media_files = filter_media_list(list_replace_captions_media(folder), selected_paths)
    matched = 0
    samples: list[dict[str, str]] = []

    for media_path in media_files:
        text, status = load_reference_caption(media_path)
        if text is None or status != "ok":
            continue

        edited = replacer(text)
        if edited is None:
            continue

        matched += 1
        if len(samples) < sample_limit:
            samples.append({"name": media_path.name, "before": text, "after": edited.strip()})

    return {
        "folder": str(folder),
        "total": len(media_files),
        "matched": matched,
        "samples": samples,
    }


def run_replace_captions_job(
    folder: Path,
    *,
    mode: str = DEFAULT_MODE,
    search: str = "",
    replacement: str = "",
    use_regex: bool = False,
    case_sensitive: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    replacer = validate_replace_captions_folder(
        folder,
        mode=mode,
        search=search,
        replacement=replacement,
        use_regex=use_regex,
        case_sensitive=case_sensitive,
    )
    media_files = filter_media_list(list_replace_captions_media(folder), selected_paths)

    def process(media_path: Path) -> FileOutcome:
        text, status = load_reference_caption(media_path)
        if text is None:
            if status == CAPTION_READ_ERROR:
                return FileOutcome.counted(CAPTION_READ_ERROR, "Could not read the caption")
            return FileOutcome.counted("no_caption", "No caption to edit")

        try:
            edited = replacer(text)
        except ValueError as exc:
            return FileOutcome.counted("write_error", exc)

        if edited is None:
            return FileOutcome.counted("skipped", "No match")

        try:
            save_caption(media_path, edited)
        except Exception as exc:
            return FileOutcome.counted("write_error", exc)

        return FileOutcome.counted("success", description=edited.strip())

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "skipped": 0,
            "no_caption": 0,
            "read_error": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        processed_stat_keys=("success", "skipped", "no_caption", "read_error", "write_error"),
    )
