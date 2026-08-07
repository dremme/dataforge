"""User-facing job failure messages. Single source of truth for API responses."""

from __future__ import annotations


def auto_caption_error_message(count: int) -> str:
    if count == 1:
        return "Failed auto-caption for 1 file. Check that the local model server is running."
    return f"Failed auto-caption for {count} files. Check that the local model server is running."


def strip_metadata_error_message(stats: dict[str, int]) -> str | None:
    ffmpeg_errors = int(stats.get("ffmpeg_error") or 0)
    write_errors = int(stats.get("write_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    error_count = ffmpeg_errors + write_errors + read_errors

    if error_count == 0:
        return None

    if ffmpeg_errors == error_count:
        if ffmpeg_errors == 1:
            return "Failed to strip metadata from 1 video. Check that ffmpeg is available."
        return (
            f"Failed to strip metadata from {ffmpeg_errors} videos. Check that ffmpeg is available."
        )

    if error_count == 1:
        return "Failed to strip metadata from 1 file."
    return f"Failed to strip metadata from {error_count} files."


def batch_rename_error_message(stats: dict[str, int]) -> str | None:
    rename_errors = int(stats.get("rename_error") or 0)
    if rename_errors == 0:
        return None
    if rename_errors == 1:
        return (
            "Failed to rename 1 file. "
            "A target filename may already exist (including sidecar), "
            "or the file could not be moved due to permissions or other OS error."
        )
    return (
        f"Failed to rename {rename_errors} files. "
        "Some target filenames may already exist (including sidecars), "
        "or files could not be moved due to permissions or other OS error."
    )


def watermark_error_message(stats: dict[str, int]) -> str | None:
    ffmpeg_errors = int(stats.get("ffmpeg_error") or 0)
    write_errors = int(stats.get("write_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    error_count = ffmpeg_errors + write_errors + read_errors

    if error_count == 0:
        return None

    if ffmpeg_errors == error_count:
        if ffmpeg_errors == 1:
            return "Failed to watermark 1 video. Check that ffmpeg is available."
        return f"Failed to watermark {ffmpeg_errors} videos. Check that ffmpeg is available."

    if error_count == 1:
        return "Failed to watermark 1 file. The original was not changed."
    return f"Failed to watermark {error_count} files. The originals were not changed."


def set_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = int(stats.get("write_error") or 0)
    if write_errors == 0:
        return None
    if write_errors == 1:
        return "Failed to write caption for 1 file."
    return f"Failed to write caption for {write_errors} files."


def backup_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = int(stats.get("write_error") or 0)
    if write_errors == 0:
        return None
    if write_errors == 1:
        return "Failed to back up the caption for 1 file."
    return f"Failed to back up captions for {write_errors} files."


def restore_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = int(stats.get("write_error") or 0)
    if write_errors == 0:
        return None
    if write_errors == 1:
        return "Failed to restore 1 caption file."
    return f"Failed to restore {write_errors} caption files."


def verify_captions_failure_message(stats: dict[str, int]) -> str | None:
    api_errors = int(stats.get("api_error") or 0)
    parse_errors = int(stats.get("parse_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    total_errors = api_errors + parse_errors + read_errors
    if total_errors == 0:
        return None

    parts: list[str] = []
    if parse_errors:
        if parse_errors == 1:
            parts.append("1 file had a model response that was not valid JSON")
        else:
            parts.append(f"{parse_errors} files had model responses that were not valid JSON")
    if api_errors:
        if api_errors == 1:
            parts.append("1 file failed its model request or returned no content")
        else:
            parts.append(f"{api_errors} files failed their model requests or returned no content")
    if read_errors:
        if read_errors == 1:
            parts.append("1 image could not be read")
        else:
            parts.append(f"{read_errors} images could not be read")

    summary = "; ".join(parts) + "."
    if parse_errors and not api_errors:
        return (
            f"{summary} The model server may be running, but the vision model did not follow "
            "the required JSON output format."
        )
    if api_errors and not parse_errors:
        from openai_settings import get_openai_model

        model_id = get_openai_model()
        return (
            f"{summary} Check that the local model server is running and the vision model "
            f'(id "{model_id}") is loaded.'
        )
    return (
        f"{summary} Check that the vision model is loaded and returns the JSON format from "
        "the system prompt."
    )


def resolve_job_error(
    *,
    job_type: str,
    stats: dict[str, int],
    stored_error: str | None,
) -> str | None:
    """Return the persisted job error, or reconstruct one from stats when missing.

    ``train_lora`` has no branch on purpose: a failed training run raises out of its
    runner, so its message is always stored and never has to be rebuilt from stats.
    """
    if stored_error:
        return stored_error

    if job_type == "verify_captions":
        return verify_captions_failure_message(stats)
    if job_type == "auto_caption":
        count = int(stats.get("api_error") or 0)
        if count > 0:
            return auto_caption_error_message(count)
    if job_type == "strip_metadata":
        return strip_metadata_error_message(stats)
    if job_type == "set_captions":
        return set_captions_error_message(stats)
    if job_type == "batch_rename":
        return batch_rename_error_message(stats)
    if job_type == "backup_captions":
        return backup_captions_error_message(stats)
    if job_type == "restore_captions":
        return restore_captions_error_message(stats)
    if job_type == "watermark":
        return watermark_error_message(stats)
    return None
