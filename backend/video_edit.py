"""Trim, crop, retime and rescale one video in place, from its untouched original.

Every render reads ``clip.mp4.bak`` rather than ``clip.mp4``. The backup is written the
first time a file is edited and is never rewritten, so a spec always describes the
finished result rather than a step on top of the last one: changing only the speed and
applying again keeps the trim, and no edit ever re-encodes an encode.

That is also why the spec is kept beside the file, in ``clip.edit.json``. Without it the
editor would re-open on an already-trimmed clip with an empty draft, and the next apply
would silently drop the trim.

Frame rate is held to the source's. ``setpts`` alone leaves the frames untouched and
compresses their timestamps, so a 2x speedup on 24 fps emits 48 fps - and a training set
that changes rate depending on which clips were retimed is not one rate any more. An
``fps`` filter pinned to the source drops frames when speeding up and repeats them when
slowing down, which is coarse and entirely destructive, and exactly right here: the
untouched original is one revert away.
"""

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

#: Long enough for a lengthy clip, short enough that a wedged encode is not a leak.
VIDEO_EDIT_TIMEOUT_SECONDS = 1800

#: `atempo` is only documented as well behaved inside this range, so a larger or smaller
#: change is expressed as a chain of links that each stay within it.
MIN_ATEMPO = 0.5
MAX_ATEMPO = 2.0

IDENTITY_EPSILON = 1e-9

#: Above this a container is lying rather than reporting, so the rate is not used.
MAX_PLAUSIBLE_FPS = 1000.0


def read_edit_spec(media: Path) -> VideoEditSpec | None:
    return read_spec(media, VideoEditSpec)


def is_identity_spec(spec: VideoEditSpec) -> bool:
    """Whether applying ``spec`` would re-encode the original into itself."""
    return (
        spec.crop is None
        and abs(spec.speed - 1.0) < IDENTITY_EPSILON
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
        and spec.trim_start < IDENTITY_EPSILON
        and spec.trim_end is None
    )


def expected_output_seconds(spec: VideoEditSpec) -> float | None:
    """How long the result will be, or None when the source runs to an unknown end."""
    if spec.trim_end is None:
        return None
    return (spec.trim_end - spec.trim_start) / spec.speed


def source_frame_rate(media: Path) -> float | None:
    """The clip's frame rate, or None when the container will not say usefully.

    OpenCV rather than ffprobe, which this project does not ship, and which is how
    ``automation/vision.py`` already asks the same question.
    """
    import cv2

    # release() covers the failed-open branch too: a capture that never opened still
    # holds the file on Windows, which would lock the very video about to be replaced.
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
    """The muxer to name explicitly, since the temp file carries no media suffix."""
    muxer = VIDEO_EDIT_MUXERS.get(media.suffix.lower())
    if muxer is None:
        raise ValueError(f"{media.suffix} videos cannot be edited")
    return muxer


def _seconds(value: float) -> str:
    return f"{value:.3f}"


def _fraction(value: float) -> str:
    return f"{value:.6f}"


def atempo_chain(speed: float) -> str:
    """``atempo`` links whose product is ``speed``, each inside the documented range."""
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
    """The video chain: crop, then scale, then retime.

    Each filter's variables refer to its own input, so ``scale``'s ``iw`` is already the
    cropped width and neither side has to compose the two by hand. Every dimension is
    truncated to an even number because ``yuv420p`` cannot express an odd one, and the
    offsets are rounded the same way to keep them on chroma boundaries.
    """
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
        # Both axes carry the same expression rather than leaving one to `-2`. The
        # panel has to predict this size to label the output, and `-2` rounds to the
        # nearest even value where this truncates - close enough to disagree by a pixel,
        # which is exactly the kind of readout that quietly lies.
        filters.append(
            f"scale=trunc(iw*{_fraction(spec.scale)}/2)*2:trunc(ih*{_fraction(spec.scale)}/2)*2"
        )

    if abs(spec.speed - 1.0) > IDENTITY_EPSILON:
        filters.append(f"setpts=PTS/{_fraction(spec.speed)}")
        # Retiming moves the timestamps and leaves the frames, so the rate comes out
        # multiplied. Pinning it back drops or repeats frames to restore it. Without a
        # readable rate there is nothing to pin to, and the output keeps ffmpeg's.
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
    """One pass that applies the whole spec.

    ``-ss`` and ``-t`` are input options on purpose. As output options they are measured
    on the output timeline, which ``setpts`` has already compressed, so a 2x speedup
    asked to stop at ten seconds would read twenty seconds of source. Input seeking has
    been frame-accurate on a transcode since ffmpeg 2.1, so nothing is given up for it.

    ``-noautorotate`` is deliberately absent: ffmpeg applies the display matrix ahead of
    the filter chain, so a crop is expressed against the frame the viewer sees.
    """
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
    # The trailing `?` is the whole no-audio story: there is no ffprobe here to ask
    # whether the source has a track, and an unmatched optional stream is not an error.
    command += ["-map", "0:v:0", "-map", "0:a:0?"]

    video_filters = build_video_filters(spec, frame_rate)
    if video_filters:
        command += ["-vf", video_filters]

    retimed = abs(spec.speed - 1.0) > IDENTITY_EPSILON
    trimmed = spec.trim_start > 0 or spec.trim_end is not None
    if retimed:
        command += ["-af", atempo_chain(spec.speed)]

    command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]

    # A stream copy lands on the nearest packet boundary, which a trim would hear as a
    # leading fragment or as a drift against the picture. Only an edit that neither
    # trims nor retimes leaves the audio alone.
    if retimed or trimmed:
        command += ["-c:a", "aac", "-b:a", "192k"]
    else:
        command += ["-c:a", "copy"]

    # Unconditional because every muxer in `VIDEO_EDIT_MUXERS` accepts it. Adding one
    # that does not - matroska, asf, flv - means putting the branch back.
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
    """Render ``spec`` from the original and put the result back under ``media``'s name.

    On any failure the live file is left byte-identical. The backup created on the way in
    survives that failure on purpose: dropping it would mean the next attempt re-copies,
    and if this one did damage the output there would be nothing left to copy from.
    """
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    muxer = resolve_muxer(media)
    sweep_edit_temp_files(media.parent)

    source = ensure_backup(media)
    temp_path = temp_path_for(media)
    # Read off the backup, which is what the render reads: the live file may already have
    # been retimed by an earlier edit, and its rate is pinned to this same answer anyway.
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
    """Put the untouched original back and forget the edit that replaced it."""
    restore_backup(media)

    return describe_edited(media, has_backup=False)
