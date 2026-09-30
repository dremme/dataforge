"""Run the Adjust wand over a folder and render each result, as its button and Apply would."""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from pathlib import Path

from automation.job_runner import CANCELLED, FileOutcome, run_media_job
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
from image_edit import apply_image_edit, read_image_edit_spec
from image_io import ImageReadError
from logging_config import configure_logging, log_job_summary
from schemas import ColorAdjust, ImageEditSpec, VideoEditSpec
from video_edit import apply_video_edit, probe_source, read_edit_spec

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]

AUTO_ADJUST_EXTENSIONS = IMAGE_EDIT_EXTENSIONS | VIDEO_EDIT_EXTENSIONS


class AlreadyAdjustedError(Exception):
    """Raised when the wand would leave the file as it is."""


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


def auto_adjust_image(media: Path, *, replace: bool = False) -> None:
    spec = read_image_edit_spec(media) or ImageEditSpec()
    pixels, weights = image_analysis_pixels(original_path_for(media), spec.masks, spec.crop)
    adjusted = _auto_adjusted(spec, suggest_adjust(pixels, weights), replace=replace)

    with render_slot(media):
        apply_image_edit(media, adjusted)


def auto_adjust_video(
    media: Path,
    *,
    replace: bool = False,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> None:
    spec = read_edit_spec(media) or VideoEditSpec()
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
        apply_video_edit(media, adjusted, ffmpeg=ffmpeg, should_cancel=should_cancel, probe=probe)


def auto_adjust_file(
    media: Path,
    *,
    replace: bool = False,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> str:
    """Adjust one file in place and return whether it was an ``image`` or a ``video``. ``replace``
    starts the Adjust tools over; the rest of an earlier edit is always kept."""
    if media.suffix.lower() in VIDEO_EDIT_EXTENSIONS:
        auto_adjust_video(media, replace=replace, ffmpeg=ffmpeg, should_cancel=should_cancel)
        return "video"

    auto_adjust_image(media, replace=replace)
    return "image"


def _failure(status: str, exc: Exception) -> FileOutcome:
    return FileOutcome(status=status, stats={status: 1}, fields={"message": str(exc)})


def run_auto_adjust_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
    replace_adjustments: bool = False,
) -> dict[str, object]:
    validate_auto_adjust_folder(folder, selected_paths)

    media_files = filter_media_list(list_auto_adjust_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    def process(media_path: Path) -> FileOutcome:
        try:
            kind = auto_adjust_file(
                media_path,
                replace=replace_adjustments,
                ffmpeg=resolved_ffmpeg,
                should_cancel=should_cancel,
            )
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except AlreadyAdjustedError:
            return FileOutcome(status="unchanged", stats={"unchanged": 1})
        except FfmpegCancelled:
            return FileOutcome(status=CANCELLED, stats={"cancelled": 1}, stop=True)
        except (EditBusyError, NothingToAnalyseError) as exc:
            return _failure("skipped", exc)
        except (ImageReadError, ValueError) as exc:
            return _failure("read_error", exc)
        except RuntimeError as exc:
            return _failure("ffmpeg_error", exc)
        except OSError as exc:
            return _failure("write_error", exc)

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


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Auto-adjust the images and MP4-family videos in a folder, keeping originals.",
    )
    parser.add_argument("folder", type=Path, help="Folder containing images and/or videos")
    parser.add_argument(
        "--replace-adjustments",
        action="store_true",
        help="Discard earlier Adjust settings so each file gets only the wand's suggestion",
    )
    args = parser.parse_args(argv)

    try:
        result = run_auto_adjust_job(
            args.folder.expanduser().resolve(), replace_adjustments=args.replace_adjustments
        )
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    stat_keys = ("success", "unchanged", "skipped", "read_error", "write_error", "ffmpeg_error")
    log_job_summary(logger, result, stat_keys=stat_keys)
    stats = result.get("stats") or {}
    failed = ("read_error", "write_error", "ffmpeg_error")
    if isinstance(stats, dict) and any(int(stats.get(key) or 0) for key in failed):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
