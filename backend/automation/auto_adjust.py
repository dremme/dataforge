"""Apply or reset color adjustments over a folder, rendering each result from its original."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, run_media_job
from automation.selection import filter_media_list, list_folder_media
from color_adjust import IDENTITY_EPSILON
from color_auto import (
    NothingToAnalyseError,
    image_analysis_pixels,
    suggest_adjust,
    video_analysis_pixels,
    with_auto,
)
from constants import IMAGE_EDIT_EXTENSIONS, VIDEO_EDIT_EXTENSIONS
from edit_sidecars import EditBusyError, original_path_for, render_slot
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, ShouldCancel
from image_edit import apply_image_edit, read_image_edit_spec, revert_image_edit
from image_edit import is_identity_spec as is_identity_image_spec
from image_io import ImageReadError
from schemas import ColorAdjust, ImageEditSpec, VideoEditSpec
from video_edit import (
    apply_video_edit,
    is_identity_spec,
    probe_source,
    read_edit_spec,
    revert_video_edit,
)

AUTO_ADJUST_EXTENSIONS = IMAGE_EDIT_EXTENSIONS | VIDEO_EDIT_EXTENSIONS


class AlreadyAdjustedError(Exception):
    """Raised when applying or resetting color adjustments would leave the file as it is."""


def list_auto_adjust_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, AUTO_ADJUST_EXTENSIONS, order="mtime")


def validate_auto_adjust_folder(folder: Path, selected_paths: list[Path] | None = None) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not filter_media_list(list_auto_adjust_files(folder), selected_paths):
        raise ValueError("No JPG, PNG, WebP, BMP, MP4, MOV or M4V files found in folder")


def _same_adjust(first: ColorAdjust, second: ColorAdjust) -> bool:
    return all(
        abs(value - getattr(second, tool)) < IDENTITY_EPSILON
        for tool, value in first.model_dump().items()
    )


def _auto_adjusted[SpecT: (ImageEditSpec, VideoEditSpec)](
    spec: SpecT, suggestion: ColorAdjust, *, replace: bool
) -> SpecT:
    if replace:
        adjust, auto = with_auto(ColorAdjust(), None, suggestion)
    else:
        adjust, auto = with_auto(spec.adjust, spec.auto_adjust, suggestion)
    if _same_adjust(adjust, spec.adjust):
        raise AlreadyAdjustedError
    return spec.model_copy(update={"adjust": adjust, "auto_adjust": auto})


def _reset_adjustments[SpecT: (ImageEditSpec, VideoEditSpec)](spec: SpecT) -> SpecT:
    adjust = ColorAdjust()
    if spec.adjust == adjust and spec.auto_adjust is None:
        raise AlreadyAdjustedError
    return spec.model_copy(update={"adjust": adjust, "auto_adjust": None})


def auto_adjust_image(media: Path, *, replace: bool = False, reset: bool = False) -> None:
    spec = read_image_edit_spec(media) or ImageEditSpec()
    if reset:
        adjusted = _reset_adjustments(spec)
    else:
        pixels, weights = image_analysis_pixels(original_path_for(media), spec.masks, spec.crop)
        adjusted = _auto_adjusted(spec, suggest_adjust(pixels, weights), replace=replace)

    # Nothing left to render: restore the original, so the file no longer reads as edited.
    with render_slot(media):
        if is_identity_image_spec(adjusted):
            revert_image_edit(media)
        else:
            apply_image_edit(media, adjusted)


def auto_adjust_video(
    media: Path,
    *,
    replace: bool = False,
    reset: bool = False,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> None:
    spec = read_edit_spec(media) or VideoEditSpec()
    probe = None
    if reset:
        adjusted = _reset_adjustments(spec)
    else:
        source = original_path_for(media)
        probe = probe_source(source)
        pixels, weights = video_analysis_pixels(
            source,
            spec.masks,
            spec.crop,
            start=spec.trim_start,
            end=spec.trim_end,
            duration=probe.seconds,
        )
        adjusted = _auto_adjusted(spec, suggest_adjust(pixels, weights), replace=replace)

    with render_slot(media):
        if is_identity_spec(adjusted):
            revert_video_edit(media)
        else:
            apply_video_edit(
                media, adjusted, ffmpeg=ffmpeg, should_cancel=should_cancel, probe=probe
            )


def auto_adjust_file(
    media: Path,
    *,
    replace: bool = False,
    reset: bool = False,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> str:
    """Apply or reset only the Adjust tools, returning ``image`` or ``video``."""
    if media.suffix.lower() in VIDEO_EDIT_EXTENSIONS:
        auto_adjust_video(
            media, replace=replace, reset=reset, ffmpeg=ffmpeg, should_cancel=should_cancel
        )
        return "video"

    auto_adjust_image(media, replace=replace, reset=reset)
    return "image"


def run_auto_adjust_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
    replace_adjustments: bool = False,
    reset_adjustments: bool = False,
) -> dict[str, object]:
    validate_auto_adjust_folder(folder, selected_paths)

    media_files = filter_media_list(list_auto_adjust_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    def process(media_path: Path) -> FileOutcome:
        try:
            kind = auto_adjust_file(
                media_path,
                replace=replace_adjustments,
                reset=reset_adjustments,
                ffmpeg=resolved_ffmpeg,
                should_cancel=should_cancel,
            )
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except AlreadyAdjustedError:
            return FileOutcome.counted("unchanged")
        except FfmpegCancelled:
            return FileOutcome.cancelled()
        except (EditBusyError, NothingToAnalyseError) as exc:
            return FileOutcome.counted("skipped", exc)
        except (ImageReadError, ValueError) as exc:
            return FileOutcome.counted("read_error", exc)
        except RuntimeError as exc:
            return FileOutcome.counted("ffmpeg_error", exc)
        except OSError as exc:
            return FileOutcome.counted("write_error", exc)

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "image_success": 0,
            "video_success": 0,
            "unchanged": 0,
            "skipped": 0,
            "read_error": 0,
            "write_error": 0,
            "ffmpeg_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        # image_success and video_success are sub-stats of success and must not be counted.
        processed_stat_keys=(
            "success",
            "unchanged",
            "skipped",
            "read_error",
            "write_error",
            "ffmpeg_error",
        ),
    )
