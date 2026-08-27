"""Trim, crop, retime and rescale one video in place from its untouched original."""

from __future__ import annotations

import logging
import math
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from constants import VIDEO_EDIT_MUXERS
from edit_sidecars import (
    ensure_backup,
    read_spec,
    restore_backup,
    stale_path_for,
    sweep_edit_temp_files,
    temp_path_for,
    write_spec,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import ProgressCallback, ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from media_dimensions import media_dimensions
from schemas import VideoEditResponse, VideoEditSpec

logger = logging.getLogger(__name__)

FFMPEG_MISSING_MESSAGE = "ffmpeg is required to edit a video"

VIDEO_EDIT_TIMEOUT_SECONDS = 1800

#: `atempo` is only documented as well behaved inside this range.
MIN_ATEMPO = 0.5
MAX_ATEMPO = 2.0

IDENTITY_EPSILON = 1e-9

#: Above this a container is lying rather than reporting, so the rate is not used.
MAX_PLAUSIBLE_FPS = 1000.0


def read_edit_spec(media: Path) -> VideoEditSpec | None:
    return read_spec(media, VideoEditSpec)


def is_identity_spec(spec: VideoEditSpec) -> bool:
    return (
        spec.crop is None
        and abs(spec.speed - 1.0) < IDENTITY_EPSILON
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
        and spec.trim_start < IDENTITY_EPSILON
        and spec.trim_end is None
    )


def expected_output_seconds(spec: VideoEditSpec) -> float | None:
    if spec.trim_end is None:
        return None
    return (spec.trim_end - spec.trim_start) / spec.speed


def source_frame_rate(media: Path) -> float | None:
    """Frame rate, or None when the container will not say. Always ``release()``: an unopened capture still locks the file on Windows."""
    import cv2

    cap = cv2.VideoCapture(str(media))
    try:
        if not cap.isOpened():
            return None
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    except Exception:
        logger.debug("No frame rate for %s", media.name, exc_info=True)
        return None
    finally:
        cap.release()

    if not math.isfinite(fps) or fps <= 0 or fps > MAX_PLAUSIBLE_FPS:
        return None
    return fps


def resolve_muxer(media: Path) -> str:
    muxer = VIDEO_EDIT_MUXERS.get(media.suffix.lower())
    if muxer is None:
        raise ValueError(f"{media.suffix} videos cannot be edited")
    return muxer


def _seconds(value: float) -> str:
    return f"{value:.3f}"


def _fraction(value: float) -> str:
    return f"{value:.6f}"


def atempo_chain(speed: float) -> str:
    links: list[float] = []
    remaining = speed

    while remaining > MAX_ATEMPO:
        links.append(MAX_ATEMPO)
        remaining /= MAX_ATEMPO
    while remaining < MIN_ATEMPO:
        links.append(MIN_ATEMPO)
        remaining /= MIN_ATEMPO

    if abs(remaining - 1.0) > IDENTITY_EPSILON:
        links.append(remaining)

    return ",".join(f"atempo={_fraction(link)}" for link in links)


def build_video_filters(spec: VideoEditSpec, frame_rate: float | None = None) -> str:
    """Crop, then scale, then retime. Dimensions are even because ``yuv420p`` cannot express an odd one."""
    filters: list[str] = []

    crop = spec.crop
    if crop is not None:
        filters.append(
            "crop="
            f"trunc(iw*{_fraction(crop.width)}/2)*2:"
            f"trunc(ih*{_fraction(crop.height)}/2)*2:"
            f"trunc(iw*{_fraction(crop.x)}/2)*2:"
            f"trunc(ih*{_fraction(crop.y)}/2)*2"
        )

    if abs(spec.scale - 1.0) > IDENTITY_EPSILON:
        # Both axes, not `-2`: that rounds to even where this truncates, disagreeing by a pixel.
        filters.append(
            f"scale=trunc(iw*{_fraction(spec.scale)}/2)*2:trunc(ih*{_fraction(spec.scale)}/2)*2"
        )

    if abs(spec.speed - 1.0) > IDENTITY_EPSILON:
        filters.append(f"setpts=PTS/{_fraction(spec.speed)}")
        # setpts compresses timestamps and keeps every frame; pin fps so a 2x 24fps clip stays 24fps.
        if frame_rate is not None:
            filters.append(f"fps={_fraction(frame_rate)}")

    return ",".join(filters)


def build_video_edit_command(
    source: Path,
    destination: Path,
    spec: VideoEditSpec,
    *,
    executable: str,
    muxer: str,
    frame_rate: float | None = None,
) -> list[str]:
    """One pass. ``-ss``/``-t`` are input options so they are measured before ``setpts`` compresses time."""
    command = [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-y",
    ]

    if spec.trim_start > 0:
        command += ["-ss", _seconds(spec.trim_start)]
    if spec.trim_end is not None:
        command += ["-t", _seconds(spec.trim_end - spec.trim_start)]

    command += ["-i", str(source)]
    # Trailing `?`: no ffprobe, and an unmatched optional stream is not an error.
    command += ["-map", "0:v:0", "-map", "0:a:0?"]

    video_filters = build_video_filters(spec, frame_rate)
    if video_filters:
        command += ["-vf", video_filters]

    retimed = abs(spec.speed - 1.0) > IDENTITY_EPSILON
    trimmed = spec.trim_start > 0 or spec.trim_end is not None
    if retimed:
        command += ["-af", atempo_chain(spec.speed)]

    command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]

    # Stream copy lands on a packet boundary; only an edit that neither trims nor retimes copies audio.
    if retimed or trimmed:
        command += ["-c:a", "aac", "-b:a", "192k"]
    else:
        command += ["-c:a", "copy"]

    # Unconditional: every muxer in `VIDEO_EDIT_MUXERS` accepts it. Matroska/asf/flv would not.
    command += ["-movflags", "+faststart"]

    command += ["-f", muxer, str(destination)]
    return command


def describe_edited(media: Path, *, has_backup: bool) -> VideoEditResponse:
    stat = media.stat()
    dimensions = media_dimensions(media, "video", stat.st_mtime_ns, stat.st_size)
    return VideoEditResponse(
        path=str(media),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        width=dimensions[0] if dimensions else None,
        height=dimensions[1] if dimensions else None,
        has_backup=has_backup,
    )


def apply_video_edit(
    media: Path,
    spec: VideoEditSpec,
    *,
    ffmpeg: str | None = None,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
) -> VideoEditResponse:
    """Render ``spec`` from the original. On failure the live file is left byte-identical."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    muxer = resolve_muxer(media)
    sweep_edit_temp_files(media.parent)

    source = ensure_backup(media)
    temp_path = temp_path_for(media)
    # Rate comes from the backup: the live file may already have been retimed.
    command = build_video_edit_command(
        source,
        temp_path,
        spec,
        executable=executable,
        muxer=muxer,
        frame_rate=source_frame_rate(source),
    )

    try:
        run_ffmpeg(
            command,
            should_cancel=should_cancel,
            on_progress=on_progress,
            timeout=VIDEO_EDIT_TIMEOUT_SECONDS,
        )
        publish_replacing(temp_path, media, stale_path_for(media))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    write_spec(media, spec)
    return describe_edited(media, has_backup=True)


def revert_video_edit(media: Path) -> VideoEditResponse:
    restore_backup(media)

    return describe_edited(media, has_backup=False)
