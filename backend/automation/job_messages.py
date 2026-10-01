"""User-facing job failure messages. Single source of truth for API responses."""

from __future__ import annotations


def _count(stats: dict[str, int], *keys: str) -> int:
    return sum(int(stats.get(key) or 0) for key in keys)


def _plural(count: int, one: str, many: str) -> str:
    """``one`` for a single file, else ``many`` with ``{n}`` filled in."""
    return one if count == 1 else many.format(n=count)


def _auto_caption_server_message(count: int) -> str:
    return _plural(
        count,
        "Failed auto-caption for 1 file. Check that the local model server is running.",
        "Failed auto-caption for {n} files. Check that the local model server is running.",
    )


def auto_caption_failure_message(stats: dict[str, int]) -> str | None:
    """Blame the model server only for ``api_error``; decode failures never reached it."""
    api_errors = _count(stats, "api_error")
    if api_errors:
        return _auto_caption_server_message(api_errors)

    media_errors = _count(stats, "read_error", "frame_error")
    if media_errors == 0:
        return None
    return _plural(
        media_errors,
        "Failed auto-caption for 1 file. It could not be read or decoded into frames.",
        "Failed auto-caption for {n} files. They could not be read or decoded into frames.",
    )


def _ffmpeg_job_message(
    stats: dict[str, int], verb: str, *, kept_one: str, kept_many: str
) -> str | None:
    ffmpeg_errors = _count(stats, "ffmpeg_error")
    error_count = _count(stats, "ffmpeg_error", "write_error", "read_error")
    if error_count == 0:
        return None

    if ffmpeg_errors == error_count:
        return _plural(
            ffmpeg_errors,
            f"Failed to {verb} 1 video. Check that ffmpeg is available.",
            f"Failed to {verb} {{n}} videos. Check that ffmpeg is available.",
        )
    return _plural(
        error_count,
        f"Failed to {verb} 1 file.{kept_one}",
        f"Failed to {verb} {{n}} files.{kept_many}",
    )


def strip_metadata_error_message(stats: dict[str, int]) -> str | None:
    return _ffmpeg_job_message(stats, "strip metadata from", kept_one="", kept_many="")


def watermark_error_message(stats: dict[str, int]) -> str | None:
    return _ffmpeg_job_message(
        stats,
        "watermark",
        kept_one=" The original was not changed.",
        kept_many=" The originals were not changed.",
    )


def auto_adjust_error_message(stats: dict[str, int]) -> str | None:
    return _ffmpeg_job_message(
        stats,
        "auto-adjust",
        kept_one=" It was left unchanged.",
        kept_many=" They were left unchanged.",
    )


def rename_media_error_message(stats: dict[str, int]) -> str | None:
    rename_errors = _count(stats, "rename_error")
    if rename_errors == 0:
        return None
    return _plural(
        rename_errors,
        "Failed to rename 1 file. "
        "A target filename may already exist (including sidecar), "
        "or the file could not be moved due to permissions or other OS error.",
        "Failed to rename {n} files. "
        "Some target filenames may already exist (including sidecars), "
        "or files could not be moved due to permissions or other OS error.",
    )


def comfy_process_error_message(stats: dict[str, int]) -> str | None:
    """Blame ComfyUI only for ``comfy_error``; read/write failures never reached the graph."""
    comfy_errors = _count(stats, "comfy_error")
    read_errors = _count(stats, "read_error")
    error_count = _count(stats, "comfy_error", "read_error", "write_error")
    if error_count == 0:
        return None

    if comfy_errors == error_count:
        return _plural(
            comfy_errors,
            "ComfyUI could not process 1 file. Check that it is running and that the "
            "preset's nodes can read it.",
            "ComfyUI could not process {n} files. Check that it is running and "
            "that the preset's nodes can read them.",
        )
    if read_errors == error_count:
        return _plural(
            read_errors,
            "1 file could not be read, so it was never sent to ComfyUI.",
            "{n} files could not be read, so they were never sent to ComfyUI.",
        )
    return _plural(
        error_count,
        "Failed to stage 1 file. The original was not changed.",
        "Failed to stage {n} files. The originals were not changed.",
    )


def check_caption_rules_error_message(stats: dict[str, int]) -> str | None:
    failed = _count(stats, "read_error", "write_error")
    if failed == 0:
        return None
    return _plural(
        failed,
        "Failed to lint 1 file. Its caption or issue file could not be read or written.",
        "Failed to lint {n} files. Their captions or issue files could not be read or written.",
    )


def set_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = _count(stats, "write_error")
    if write_errors == 0:
        return None
    return _plural(
        write_errors,
        "Failed to write caption for 1 file.",
        "Failed to write caption for {n} files.",
    )


def replace_captions_error_message(stats: dict[str, int]) -> str | None:
    read_errors = _count(stats, "read_error")
    error_count = _count(stats, "read_error", "write_error")
    if error_count == 0:
        return None

    if read_errors == error_count:
        return _plural(
            read_errors,
            "Could not read the caption for 1 file. It was left unchanged.",
            "Could not read captions for {n} files. They were left unchanged.",
        )
    return _plural(
        error_count,
        "Failed to edit the caption for 1 file.",
        "Failed to edit captions for {n} files.",
    )


def find_duplicates_error_message(stats: dict[str, int]) -> str | None:
    write_errors = _count(stats, "write_error")
    if write_errors:
        return _plural(
            write_errors,
            "Failed to flag 1 file as a duplicate.",
            "Failed to flag {n} files as duplicates.",
        )

    read_errors = _count(stats, "read_error")
    if read_errors == 0:
        return None
    return _plural(
        read_errors,
        "1 file could not be read and was left out of the comparison.",
        "{n} files could not be read and were left out of the comparison.",
    )


def backup_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = _count(stats, "write_error")
    if write_errors == 0:
        return None
    return _plural(
        write_errors,
        "Failed to back up the caption for 1 file.",
        "Failed to back up captions for {n} files.",
    )


def restore_captions_error_message(stats: dict[str, int]) -> str | None:
    write_errors = _count(stats, "write_error")
    if write_errors == 0:
        return None
    return _plural(
        write_errors,
        "Failed to restore 1 caption file.",
        "Failed to restore {n} caption files.",
    )


def _model_server_hint(subject: str) -> str:
    from openai_settings import get_openai_model

    return (
        f"Check that the local model server is running and the {subject} "
        f'(id "{get_openai_model()}") is loaded.'
    )


def verify_captions_failure_message(stats: dict[str, int]) -> str | None:
    api_errors = _count(stats, "api_error")
    parse_errors = _count(stats, "parse_error")
    read_errors = _count(stats, "read_error")
    frame_errors = _count(stats, "frame_error")
    if api_errors + parse_errors + read_errors + frame_errors == 0:
        return None

    parts = [
        _plural(count, one, many)
        for count, one, many in (
            (
                parse_errors,
                "1 file had a model response that was not valid JSON",
                "{n} files had model responses that were not valid JSON",
            ),
            (
                api_errors,
                "1 file failed its model request or returned no content",
                "{n} files failed their model requests or returned no content",
            ),
            (read_errors, "1 file could not be read", "{n} files could not be read"),
            (
                frame_errors,
                "1 video could not yield keyframes",
                "{n} videos could not yield keyframes",
            ),
        )
        if count
    ]
    summary = "; ".join(parts) + "."

    if parse_errors and not api_errors and not frame_errors:
        return (
            f"{summary} The model server may be running, but the vision model did not follow "
            "the required JSON output format."
        )
    if api_errors and not parse_errors and not frame_errors:
        return f"{summary} {_model_server_hint('vision model')}"
    if frame_errors and not api_errors and not parse_errors:
        return f"{summary} The files may be corrupt or unreadable by the frame extractor."
    return (
        f"{summary} Check that the vision model is loaded and returns the JSON format from "
        "the system prompt."
    )


def edit_captions_failure_message(stats: dict[str, int]) -> str | None:
    """Errors only; ``rejected`` and ``no_caption`` are warnings, not failures."""
    api_errors = _count(stats, "api_error")
    read_errors = _count(stats, "read_error")
    write_errors = _count(stats, "write_error")
    if api_errors + read_errors + write_errors == 0:
        return None

    parts = [
        _plural(count, one, many)
        for count, one, many in (
            (
                api_errors,
                "1 caption failed its model request or returned no content",
                "{n} captions failed their model requests or returned no content",
            ),
            (read_errors, "1 caption could not be read", "{n} captions could not be read"),
            (
                write_errors,
                "1 caption could not be backed up or written",
                "{n} captions could not be backed up or written",
            ),
        )
        if count
    ]
    summary = "; ".join(parts) + "."

    if api_errors and not read_errors and not write_errors:
        return f"{summary} {_model_server_hint('model')}"
    return summary
