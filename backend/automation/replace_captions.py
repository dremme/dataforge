"""Utility job to edit existing captions in bulk: find and replace, prepend, or append text."""

from __future__ import annotations

import argparse
import logging
import re
from collections.abc import Callable
from pathlib import Path

from automation.job_runner import FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from captions import load_reference_caption, save_caption
from constants import MEDIA_EXTENSIONS
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

#: Mirrors ``schemas.CaptionReplaceMode``.
REPLACE_MODES = ("replace", "prepend", "append")

DEFAULT_MODE = "replace"

#: Applies one edit to one caption, or returns None when the caption is unchanged.
CaptionReplacer = Callable[[str], str | None]


def build_caption_replacer(
    *,
    mode: str = DEFAULT_MODE,
    search: str = "",
    replacement: str = "",
    use_regex: bool = False,
    case_sensitive: bool = False,
) -> CaptionReplacer:
    """Compile one reusable edit, so the pattern is parsed once per job, not once per file.

    Both the job and its preview go through here; a second implementation would let the
    preview promise an edit the job does not make.

    Raises ``ValueError`` for an edit that cannot run at all - an unknown mode, a missing
    search term, or a regex that does not compile.
    """
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

    def replace(text: str) -> str | None:
        try:
            edited = pattern.sub(replacement, text)
        except re.error as exc:
            # Group references are only resolved against a real match, so a bad
            # template (``\9`` with one group) cannot be caught at compile time.
            raise ValueError(f"Invalid replacement text: {exc}") from exc
        return _changed(text, edited)

    return replace


def _build_affixer(*, mode: str, addition: str, case_sensitive: bool) -> CaptionReplacer:
    # Compared stripped, because ``save_caption`` strips: adding only whitespace is a no-op.
    trimmed = addition.strip()
    if not trimmed:
        raise ValueError("Enter the text to add")

    needle = trimmed if case_sensitive else trimmed.lower()

    def affix(text: str) -> str | None:
        # Skip captions that already carry the addition, so re-running the job does
        # not stack a second copy of the trigger word onto every caption.
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
    """The edited caption, or None when saving it would not change the sidecar.

    ``save_caption`` strips before writing, so an edit that only adds outer
    whitespace is not a change.
    """
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
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_replace_captions_media(folder):
        raise ValueError("No supported images or videos found in folder")

    # Raises for an unusable edit, so a bad regex is a 400 instead of a failed job.
    build_caption_replacer(
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
    """Count the captions this edit would change, with a few before/after samples.

    Read-only: the dialog calls this while the user types, so it never writes.
    """
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
    validate_replace_captions_folder(
        folder,
        mode=mode,
        search=search,
        replacement=replacement,
        use_regex=use_regex,
        case_sensitive=case_sensitive,
    )

    replacer = build_caption_replacer(
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
            if status.startswith("read_error"):
                return FileOutcome(
                    status="read_error",
                    stats={"read_error": 1},
                    fields={"message": status},
                )
            return FileOutcome(
                status="no_caption",
                stats={"no_caption": 1},
                fields={"message": "No caption to edit"},
            )

        try:
            edited = replacer(text)
        except ValueError as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

        if edited is None:
            return FileOutcome(
                status="skipped",
                stats={"skipped": 1},
                fields={"message": "No match"},
            )

        try:
            save_caption(media_path, edited)
        except Exception as exc:
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


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Find and replace, prepend, or append text across the captions in a folder.",
    )
    parser.add_argument("folder", type=Path, help="Folder containing images and/or videos")
    parser.add_argument(
        "--mode",
        choices=REPLACE_MODES,
        default=DEFAULT_MODE,
        help="Edit to apply to each caption",
    )
    parser.add_argument("--search", default="", help="Text to search for (replace mode)")
    parser.add_argument(
        "--replacement",
        default="",
        help="Replacement text, or the text to add in prepend/append mode",
    )
    parser.add_argument(
        "--regex",
        action="store_true",
        help="Treat the search term as a regular expression",
    )
    parser.add_argument(
        "--case-sensitive",
        action="store_true",
        help="Match case exactly instead of ignoring it",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_replace_captions_job(
            folder,
            mode=args.mode,
            search=args.search,
            replacement=args.replacement,
            use_regex=args.regex,
            case_sensitive=args.case_sensitive,
        )
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=("success", "skipped", "no_caption", "read_error", "write_error", "cancelled"),
    )
    stats = result.get("stats") or {}
    if isinstance(stats, dict) and int(stats.get("write_error") or 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
