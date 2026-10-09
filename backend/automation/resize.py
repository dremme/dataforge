"""Fit a folder's images and videos to a megapixel budget on a pixel grid, rendering each from its
original. The rule is stored in the edit sidecar, so the editor shows it and a revert undoes it."""

from __future__ import annotations

from pathlib import Path

from automation.job_runner import FileOutcome, ProgressCallback, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import IMAGE_EDIT_EXTENSIONS, VIDEO_EDIT_EXTENSIONS
from edit_sidecars import EditBusyError, original_path_for, render_slot
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, ShouldCancel
from image_edit import apply_image_edit, fit_input_size, read_image_edit_spec
from image_io import ImageReadError, load_image_for_edit
from schemas import ImageEditSpec, SizeFit, VideoEditSpec
from size_fit import fitted_size
from video_edit import apply_video_edit, cropped_frame_size, probe_source, read_edit_spec

RESIZE_EXTENSIONS = IMAGE_EDIT_EXTENSIONS | VIDEO_EDIT_EXTENSIONS


class AlreadyResizedError(Exception):
    """Raised when the rule is already stored, or would leave the file's size as it is."""


class TooSmallToResizeError(Exception):
    """Raised when a side is shorter than one grid cell, which only an upscale could fill."""


def list_resize_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, RESIZE_EXTENSIONS, order="mtime")


def validate_resize_folder(folder: Path, selected_paths: list[Path] | None = None) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not filter_media_list(list_resize_files(folder), selected_paths):
        raise ValueError("No JPG, PNG, WebP, BMP, MP4, MOV or M4V files found in folder")


def _with_fit[SpecT: (ImageEditSpec, VideoEditSpec)](
    spec: SpecT, fit: SizeFit, frame: tuple[int, int] | None, *, even: bool
) -> SpecT:
    """``frame`` is what the scale step receives; ``None`` when it could not be read."""
    if spec.fit == fit:
        raise AlreadyResizedError

    if frame is not None:
        target = fitted_size(frame, fit, even=even)
        if target is None:
            raise TooSmallToResizeError(
                f"{frame[0]} x {frame[1]} px is smaller than one {fit.multiple} px cell"
            )
        # Storing a rule that changes nothing would re-encode the file for no gain.
        if target == frame and spec.fit is None and spec.scale == 1.0:
            raise AlreadyResizedError

    return spec.model_copy(update={"fit": fit, "scale": 1.0})


def resize_image(media: Path, fit: SizeFit) -> None:
    spec = read_image_edit_spec(media) or ImageEditSpec()
    # Loaded as the render loads it: EXIF orientation decides which side is the width.
    image, _, _ = load_image_for_edit(original_path_for(media))
    resized = _with_fit(spec, fit, fit_input_size(image.size, spec), even=False)

    with render_slot(media):
        apply_image_edit(media, resized)


def resize_video(
    media: Path,
    fit: SizeFit,
    *,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> None:
    spec = read_edit_spec(media) or VideoEditSpec()
    probe = probe_source(original_path_for(media))
    frame = cropped_frame_size(probe.size, spec) if probe.size else None
    resized = _with_fit(spec, fit, frame, even=True)

    with render_slot(media):
        apply_video_edit(media, resized, ffmpeg=ffmpeg, should_cancel=should_cancel, probe=probe)


def resize_file(
    media: Path,
    fit: SizeFit,
    *,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> str:
    """Store and render ``fit``, returning ``image`` or ``video``."""
    if media.suffix.lower() in VIDEO_EDIT_EXTENSIONS:
        resize_video(media, fit, ffmpeg=ffmpeg, should_cancel=should_cancel)
        return "video"

    resize_image(media, fit)
    return "image"


def run_resize_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
    megapixels: float,
    multiple: int,
) -> dict[str, object]:
    validate_resize_folder(folder, selected_paths)

    fit = SizeFit(megapixels=megapixels, multiple=multiple)
    media_files = filter_media_list(list_resize_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    def process(media_path: Path) -> FileOutcome:
        try:
            kind = resize_file(media_path, fit, ffmpeg=resolved_ffmpeg, should_cancel=should_cancel)
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except AlreadyResizedError:
            return FileOutcome.counted("unchanged")
        except FfmpegCancelled:
            return FileOutcome.cancelled()
        except (EditBusyError, TooSmallToResizeError) as exc:
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
