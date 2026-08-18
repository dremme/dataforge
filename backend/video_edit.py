"""Trim, crop, retime and rescale one video in place, from its untouched original.

Every render reads ``clip.mp4.bak`` rather than ``clip.mp4``. The backup is written the
first time a file is edited and is never rewritten, so a spec always describes the
finished result rather than a step on top of the last one: changing only the speed and
applying again keeps the trim, and no edit ever re-encodes an encode.

That is also why the spec is kept beside the file, in ``clip.edit.json``. Without it the
editor would re-open on an already-trimmed clip with an empty draft, and the next apply
would silently drop the trim.

Frame rate is deliberately left alone. Retiming to 2x on a 30 fps source yields 60 fps
and 0.5x yields 15 fps; neither this module nor the browser knows the source's rate -
there is no ffprobe here, see ``automation/audio.py`` - so any ``fps=`` filter would be a
guess dressed up as a decision. Frame interpolation is out of scope.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from datetime import UTC, datetime
from pathlib import Path

from constants import (
    VIDEO_BACKUP_SUFFIX,
    VIDEO_EDIT_MUXERS,
    VIDEO_EDIT_SIDECAR_SUFFIX,
    VIDEO_EDIT_STALE_SUFFIX,
    VIDEO_EDIT_TEMP_SUFFIX,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import ProgressCallback, ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from media_dimensions import media_dimensions
from schemas import VideoEditResponse, VideoEditSpec

logger = logging.getLogger(__name__)

FFMPEG_MISSING_MESSAGE = "ffmpeg is required to edit a video"
NO_BACKUP_MESSAGE = "No original is stored for this file"

#: Long enough for a lengthy clip, short enough that a wedged encode is not a leak.
VIDEO_EDIT_TIMEOUT_SECONDS = 1800

#: `atempo` is only documented as well behaved inside this range, so a larger or smaller
#: change is expressed as a chain of links that each stay within it.
MIN_ATEMPO = 0.5
MAX_ATEMPO = 2.0

IDENTITY_EPSILON = 1e-9


BUSY_MESSAGE = "This video is already being edited"


class VideoEditBusyError(Exception):
    """Raised when a render for the same file is already running."""


_renders: dict[str, threading.Event] = {}
_renders_lock = threading.Lock()


def _render_key(media: Path) -> str:
    return os.path.normcase(str(media))


@contextmanager
def render_slot(media: Path) -> Iterator[Callable[[], bool]]:
    """Hold the one render slot for ``media``, yielding its cancellation check.

    A second request for the same file is refused rather than queued: the caller is a
    double-clicked Apply far more often than it is two people, and stacking encodes onto
    one file would have the later one publish over the earlier one's result.
    """
    key = _render_key(media)
    cancelled = threading.Event()

    with _renders_lock:
        if key in _renders:
            raise VideoEditBusyError(BUSY_MESSAGE)
        _renders[key] = cancelled

    try:
        yield cancelled.is_set
    finally:
        with _renders_lock:
            _renders.pop(key, None)


def cancel_render(media: Path) -> bool:
    """Ask an in-flight render for ``media`` to stop. False if there is none."""
    with _renders_lock:
        cancelled = _renders.get(_render_key(media))

    if cancelled is None:
        return False

    cancelled.set()
    return True


def backup_path_for(media: Path) -> Path:
    """``clip.mp4`` -> ``clip.mp4.bak``, appended so containers keep distinct backups."""
    return media.with_name(f"{media.name}{VIDEO_BACKUP_SUFFIX}")


def edit_spec_path(media: Path) -> Path:
    return media.with_suffix(VIDEO_EDIT_SIDECAR_SUFFIX)


def _temp_path(media: Path) -> Path:
    return media.with_name(f"{media.name}{VIDEO_EDIT_TEMP_SUFFIX}")


def _stale_path(media: Path) -> Path:
    return media.with_name(f"{media.name}{VIDEO_EDIT_STALE_SUFFIX}")


def read_edit_spec(media: Path) -> VideoEditSpec | None:
    """The edit that produced the current file, or None if it has never been edited."""
    path = edit_spec_path(media)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    try:
        return VideoEditSpec.model_validate(json.loads(raw))
    except ValueError:
        logger.warning("Ignoring unreadable edit spec %s", path.name, exc_info=True)
        return None


def write_edit_spec(media: Path, spec: VideoEditSpec) -> None:
    edit_spec_path(media).write_text(json.dumps(spec.model_dump(), indent=2), encoding="utf-8")


def clear_edit_spec(media: Path) -> None:
    with suppress(OSError):
        edit_spec_path(media).unlink(missing_ok=True)


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


def sweep_edit_temp_files(folder: Path) -> None:
    """Drop what a hard kill left behind; this is a folder the user browses."""
    with suppress(OSError):
        for suffix in (VIDEO_EDIT_TEMP_SUFFIX, VIDEO_EDIT_STALE_SUFFIX):
            for leftover in folder.glob(f"*{suffix}"):
                leftover.unlink(missing_ok=True)


def ensure_backup(media: Path) -> Path:
    """Store the untouched original, once. An existing backup is never rewritten.

    A copy rather than a rename: the browser may be streaming ``media`` right now, and
    renaming it away would make its path vanish for the length of the encode - which the
    folder watcher pushes, and which the open modal answers by closing itself.

    The copy lands on a temp name first, so a crash or a full disk cannot leave a
    truncated file sitting at the backup name, where nothing would ever notice it.
    """
    backup = backup_path_for(media)
    if backup.exists():
        return backup

    pending = backup.with_name(f"{backup.name}-tmp")
    try:
        shutil.copy2(media, pending)
        os.replace(pending, backup)
    finally:
        with suppress(OSError):
            pending.unlink(missing_ok=True)

    return backup


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


def build_video_filters(spec: VideoEditSpec) -> str:
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

    return ",".join(filters)


def build_video_edit_command(
    source: Path,
    destination: Path,
    spec: VideoEditSpec,
    *,
    executable: str,
    muxer: str,
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

    video_filters = build_video_filters(spec)
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
    temp_path = _temp_path(media)
    command = build_video_edit_command(source, temp_path, spec, executable=executable, muxer=muxer)

    try:
        run_ffmpeg(
            command,
            should_cancel=should_cancel,
            on_progress=on_progress,
            timeout=VIDEO_EDIT_TIMEOUT_SECONDS,
        )
        publish_replacing(temp_path, media, _stale_path(media))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    write_edit_spec(media, spec)
    return describe_edited(media, has_backup=True)


def revert_video_edit(media: Path) -> VideoEditResponse:
    """Put the untouched original back and forget the edit that replaced it.

    The backup is copied rather than renamed so a failure to install it still leaves a
    recoverable original, and it is only removed once the live file matches it.
    """
    backup = backup_path_for(media)
    if not backup.is_file():
        raise ValueError(NO_BACKUP_MESSAGE)

    sweep_edit_temp_files(media.parent)
    temp_path = _temp_path(media)

    try:
        shutil.copy2(backup, temp_path)
        publish_replacing(temp_path, media, _stale_path(media))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    with suppress(OSError):
        backup.unlink(missing_ok=True)
    clear_edit_spec(media)

    return describe_edited(media, has_backup=False)
