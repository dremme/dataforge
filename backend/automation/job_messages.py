"""User-facing job failure messages. Single source of truth for API responses."""

from __future__ import annotations


def auto_caption_error_message(count: int) -> str:
    if count == 1:
        return "Failed auto-caption for 1 file. Check that the local model server is running."
    return f"Failed auto-caption for {count} files. Check that the local model server is running."


def auto_caption_failure_message(stats: dict[str, int]) -> str | None:
    """Blame the model server only for ``api_error``; decode failures never reached it."""
    api_errors = int(stats.get("api_error") or 0)
    if api_errors:
        return auto_caption_error_message(api_errors)

    media_errors = int(stats.get("read_error") or 0) + int(stats.get("frame_error") or 0)
    if media_errors == 0:
        return None
    if media_errors == 1:
        return "Failed auto-caption for 1 file. It could not be read or decoded into frames."
    return (
        f"Failed auto-caption for {media_errors} files. "
        "They could not be read or decoded into frames."
    )


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


def rename_media_error_message(stats: dict[str, int]) -> str | None:
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


def comfy_process_error_message(stats: dict[str, int]) -> str | None:
    """Blame ComfyUI only for ``comfy_error``; read/write failures never reached the graph."""
    comfy_errors = int(stats.get("comfy_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    write_errors = int(stats.get("write_error") or 0)
    error_count = comfy_errors + read_errors + write_errors

    if error_count == 0:
        return None

    if comfy_errors == error_count:
        if comfy_errors == 1:
            return (
                "ComfyUI could not process 1 image. Check that it is running and that the "
                "preset's nodes are installed."
            )
        return (
            f"ComfyUI could not process {comfy_errors} images. Check that it is running and "
            "that the preset's nodes are installed."
        )

    if read_errors == error_count:
        if read_errors == 1:
            return "1 image could not be read, so it was never sent to ComfyUI."
        return f"{read_errors} images could not be read, so they were never sent to ComfyUI."

    if error_count == 1:
        return "Failed to stage 1 image. The original was not changed."
    return f"Failed to stage {error_count} images. The originals were not changed."


def set_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = int(stats.get("write_error") or 0)
    if write_errors == 0:
        return None
    if write_errors == 1:
        return "Failed to write caption for 1 file."
    return f"Failed to write caption for {write_errors} files."


def replace_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = int(stats.get("write_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    error_count = write_errors + read_errors

    if error_count == 0:
        return None

    if read_errors == error_count:
        if read_errors == 1:
            return "Could not read the caption for 1 file. It was left unchanged."
        return f"Could not read captions for {read_errors} files. They were left unchanged."

    if error_count == 1:
        return "Failed to edit the caption for 1 file."
    return f"Failed to edit captions for {error_count} files."


def find_duplicates_error_message(stats: dict[str, int]) -> str | None:
    read_errors = int(stats.get("read_error") or 0)
    write_errors = int(stats.get("write_error") or 0)

    if write_errors:
        if write_errors == 1:
            return "Failed to flag 1 file as a duplicate."
        return f"Failed to flag {write_errors} files as duplicates."

    if read_errors == 0:
        return None

    if read_errors == 1:
        return "1 file could not be read and was left out of the comparison."
    return f"{read_errors} files could not be read and were left out of the comparison."


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
    frame_errors = int(stats.get("frame_error") or 0)
    total_errors = api_errors + parse_errors + read_errors + frame_errors
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
            parts.append("1 file could not be read")
        else:
            parts.append(f"{read_errors} files could not be read")
    if frame_errors:
        if frame_errors == 1:
            parts.append("1 video could not yield keyframes")
        else:
            parts.append(f"{frame_errors} videos could not yield keyframes")

    summary = "; ".join(parts) + "."
    if parse_errors and not api_errors and not frame_errors:
        return (
            f"{summary} The model server may be running, but the vision model did not follow "
            "the required JSON output format."
        )
    if api_errors and not parse_errors and not frame_errors:
        from openai_settings import get_openai_model

        model_id = get_openai_model()
        return (
            f"{summary} Check that the local model server is running and the vision model "
            f'(id "{model_id}") is loaded.'
        )
    if frame_errors and not api_errors and not parse_errors:
        return f"{summary} The files may be corrupt or unreadable by the frame extractor."
    return (
        f"{summary} Check that the vision model is loaded and returns the JSON format from "
        "the system prompt."
    )


def edit_captions_failure_message(stats: dict[str, int]) -> str | None:
    """Errors only; ``rejected`` and ``no_caption`` are warnings, not failures."""
    api_errors = int(stats.get("api_error") or 0)
    read_errors = int(stats.get("read_error") or 0)
    write_errors = int(stats.get("write_error") or 0)
    if api_errors + read_errors + write_errors == 0:
        return None

    parts: list[str] = []
    if api_errors:
        if api_errors == 1:
            parts.append("1 caption failed its model request or returned no content")
        else:
            parts.append(
                f"{api_errors} captions failed their model requests or returned no content"
            )
    if read_errors:
        if read_errors == 1:
            parts.append("1 caption could not be read")
        else:
            parts.append(f"{read_errors} captions could not be read")
    if write_errors:
        if write_errors == 1:
            parts.append("1 caption could not be backed up or written")
        else:
            parts.append(f"{write_errors} captions could not be backed up or written")

    summary = "; ".join(parts) + "."
    if api_errors and not read_errors and not write_errors:
        from openai_settings import get_openai_model

        model_id = get_openai_model()
        return (
            f"{summary} Check that the local model server is running and the model "
            f'(id "{model_id}") is loaded.'
        )
    return summary


def resolve_job_error(
    *,
    job_type: str,
    stats: dict[str, int],
    stored_error: str | None,
) -> str | None:
    """Return the persisted job error, or reconstruct one from stats when missing."""
    if stored_error:
        return stored_error

    if job_type == "verify_captions":
        return verify_captions_failure_message(stats)
    if job_type == "edit_captions":
        return edit_captions_failure_message(stats)
    if job_type == "auto_caption":
        return auto_caption_failure_message(stats)
    if job_type == "strip_metadata":
        return strip_metadata_error_message(stats)
    if job_type == "set_captions":
        return set_captions_error_message(stats)
    if job_type == "replace_captions":
        return replace_captions_error_message(stats)
    if job_type == "find_duplicates":
        return find_duplicates_error_message(stats)
    if job_type == "batch_rename":
        return rename_media_error_message(stats)
    if job_type == "backup_captions":
        return backup_captions_error_message(stats)
    if job_type == "restore_captions":
        return restore_captions_error_message(stats)
    if job_type == "watermark":
        return watermark_error_message(stats)
    if job_type == "comfy_process":
        return comfy_process_error_message(stats)
    return None
