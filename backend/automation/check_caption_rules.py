"""Check every caption against the nearest .captionrules file and record the hits as issues."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, ShouldCancel, run_media_job
from automation.selection import filter_media_list, list_folder_media
from caption_rules import CaptionRuleChecker, cap_rule_findings, load_caption_rules_for
from captions import NO_CAPTION_STATUS, load_reference_caption, save_issue_findings
from constants import MEDIA_EXTENSIONS


def list_check_caption_rules_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_check_caption_rules_folder(folder: Path) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    load_caption_rules_for(folder)

    if not list_check_caption_rules_media(folder):
        raise ValueError("No supported images or videos found in folder")


def run_check_caption_rules_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_check_caption_rules_folder(folder)

    checker = CaptionRuleChecker(load_caption_rules_for(folder))
    media_files = filter_media_list(list_check_caption_rules_media(folder), selected_paths)

    def process(media_path: Path) -> FileOutcome:
        caption, status = load_reference_caption(media_path)

        if caption is None and status != NO_CAPTION_STATUS:
            return FileOutcome(
                status="read_error", stats={"read_error": 1}, fields={"message": status}
            )

        findings = [] if caption is None else cap_rule_findings(checker.check(caption))
        try:
            save_issue_findings(media_path, "rules", findings)
        except OSError as exc:
            return FileOutcome(
                status="write_error", stats={"write_error": 1}, fields={"message": str(exc)}
            )

        if caption is None:
            return FileOutcome(status=NO_CAPTION_STATUS, stats={NO_CAPTION_STATUS: 1})
        if not findings:
            return FileOutcome(status="success", stats={"success": 1})
        return FileOutcome(
            status="success",
            stats={"success": 1, "issues_found": 1},
            fields={"description": "; ".join(findings)},
        )

    # ``issues_found`` is a sub-stat of success and must not inflate ``processed``.
    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "issues_found": 0,
            NO_CAPTION_STATUS: 0,
            "read_error": 0,
            "write_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
    )
