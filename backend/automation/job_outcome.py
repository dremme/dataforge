"""Job severity and outcome prose, derived from the stats the workers recorded."""

from __future__ import annotations

from constants import CAPTION_SIDECAR_EXTENSIONS, JOB_TYPE_LABELS
from filesystem import path_leaf_name
from schemas import JobResponse, JobType, NotificationVariant

PRIMARY_JOB_TYPE: JobType = "auto_caption"

TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "cancelled", "interrupted"})

#: Types whose only completed outcome is success; nothing they count reads as a warning.
_NEVER_WARN: frozenset[str] = frozenset(
    {
        "strip_metadata",
        "set_captions",
        "batch_rename",
        "backup_captions",
        "train_lora",
        "watermark",
    }
)

_CAPTION_SIDECAR_LIST = "/".join(CAPTION_SIDECAR_EXTENSIONS)


def job_type_label(job_type: str) -> str:
    return JOB_TYPE_LABELS.get(job_type) or job_type.strip()


def _known_job_type(job_type: str) -> str:
    return job_type if job_type in JOB_TYPE_LABELS else PRIMARY_JOB_TYPE


def _count(stats: dict[str, int], *keys: str) -> int:
    return sum(int(stats.get(key) or 0) for key in keys)


#: The stat keys that demote a completed job of this type to a failure.
_FAILURE_KEYS: dict[str, tuple[str, ...]] = {
    "verify_captions": ("api_error", "parse_error", "read_error", "frame_error"),
    "auto_caption": ("api_error", "read_error", "frame_error"),
}


def effective_status(job_type: str, status: str, stats: dict[str, int]) -> str:
    """The status once stats are taken into account: errors demote a completed job to failed."""
    if status != "completed":
        return status

    keys = _FAILURE_KEYS.get(_known_job_type(job_type), ("api_error",))
    return "failed" if _count(stats, *keys) else "completed"


def shows_error_state(job_type: str, status: str, stats: dict[str, int]) -> bool:
    return effective_status(job_type, status, stats) in ("failed", "interrupted")


def is_cancelled(job_type: str, status: str, stats: dict[str, int]) -> bool:
    return effective_status(job_type, status, stats) == "cancelled"


def _no_caption_warning(count: int) -> str | None:
    if count == 0:
        return None
    if count == 1:
        return f"1 file had no caption sidecar ({_CAPTION_SIDECAR_LIST}) and was skipped."
    return f"{count} files had no caption sidecar ({_CAPTION_SIDECAR_LIST}) and were skipped."


def _rejected_warning(count: int) -> str | None:
    if count == 0:
        return None
    if count == 1:
        return "1 caption came back in a form the job would not write, and was left unchanged."
    return f"{count} captions came back in a form the job would not write, and were left unchanged."


def _no_audio_warning(count: int) -> str | None:
    if count == 0:
        return None
    if count == 1:
        return "1 video had no audio track and was captioned without it."
    return f"{count} videos had no audio track and were captioned without them."


def shows_warning_state(job_type: str, status: str, stats: dict[str, int]) -> bool:
    if shows_error_state(job_type, status, stats) or is_cancelled(job_type, status, stats):
        return False
    if status != "completed":
        return False

    known = _known_job_type(job_type)
    if known == "restore_captions":
        return _count(stats, "orphaned") > 0
    if known in _NEVER_WARN:
        return False
    if known == "auto_caption":
        return _count(stats, "no_caption", "audio_error") > 0
    if known == "edit_captions":
        return _count(stats, "no_caption", "rejected") > 0
    return _count(stats, "no_caption") > 0


def warning_message(job_type: str, status: str, stats: dict[str, int]) -> str | None:
    """The job's warning prose, or ``None`` when it finished cleanly."""
    if not shows_warning_state(job_type, status, stats):
        return None

    known = _known_job_type(job_type)
    if known == "restore_captions":
        orphaned = _count(stats, "orphaned")
        if orphaned == 1:
            return "1 backed up caption had no matching media file and was skipped."
        return f"{orphaned} backed up captions had no matching media file and were skipped."

    parts = [_no_caption_warning(_count(stats, "no_caption"))]
    if known == "auto_caption":
        parts.append(_no_audio_warning(_count(stats, "audio_error")))
    if known == "edit_captions":
        parts.append(_rejected_warning(_count(stats, "rejected")))

    return " ".join(part for part in parts if part) or None


def completion_notification(snapshot: dict[str, object]) -> tuple[NotificationVariant, str] | None:
    """The toast a finished job earns, or ``None`` while it is still running."""
    status = str(snapshot.get("status") or "")
    if status not in TERMINAL_STATUSES:
        return None

    job_type = str(snapshot.get("job_type") or PRIMARY_JOB_TYPE)
    raw_stats = snapshot.get("stats")
    stats = dict(raw_stats) if isinstance(raw_stats, dict) else {}
    folder = str(snapshot.get("folder_name") or "") or path_leaf_name(
        str(snapshot.get("folder") or "")
    )
    label = job_type_label(job_type)

    if shows_error_state(job_type, status, stats):
        detail = snapshot.get("error")
        if isinstance(detail, str) and detail:
            return "danger", f'{label} failed in "{folder}": {detail}'
        return "danger", f'{label} failed in "{folder}".'

    if is_cancelled(job_type, status, stats):
        return "warning", f'{label} cancelled in "{folder}".'

    if shows_warning_state(job_type, status, stats):
        detail = warning_message(job_type, status, stats)
        if detail:
            return "warning", f'{label} finished with warnings in "{folder}": {detail}'
        return "warning", f'{label} finished with warnings in "{folder}".'

    return "success", f'{label} completed in "{folder}".'


def job_response(snapshot: dict[str, object]) -> JobResponse:
    """The only place the derived outcome fields are filled in, so they cannot drift."""
    job_type = str(snapshot.get("job_type") or PRIMARY_JOB_TYPE)
    status = str(snapshot.get("status") or "")
    raw_stats = snapshot.get("stats")
    stats = dict(raw_stats) if isinstance(raw_stats, dict) else {}

    return JobResponse.model_validate(
        {
            **snapshot,
            "effective_status": effective_status(job_type, status, stats),
            "warning": warning_message(job_type, status, stats),
        }
    )
