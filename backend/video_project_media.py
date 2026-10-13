"""Timeline pictures: a strip of frames across a clip's take, and a whole-file waveform the
timeline crops to each clip. Cached beside the gallery thumbnails, keyed by the file's stat."""

from __future__ import annotations

import hashlib
import os
import tempfile
import threading
from pathlib import Path

from ffmpeg_run import run_ffmpeg
from thumbnails import (
    PARTIAL_SUFFIX,
    THUMBNAIL_SUFFIX,
    ThumbnailUnavailableError,
    get_thumbnail_cache_dir,
)

FILMSTRIP_MAX_FRAMES = 16
FILMSTRIP_MIN_HEIGHT = 24
FILMSTRIP_MAX_HEIGHT = 160
WAVEFORM_MIN_WIDTH = 200
WAVEFORM_MAX_WIDTH = 4000
WAVEFORM_HEIGHT = 96
TIMELINE_MEDIA_TIMEOUT_SECONDS = 120
#: Part of the cache key; bump it when either picture is drawn differently.
TIMELINE_MEDIA_VERSION = 1

_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _cache_path(source: Path, kind: str, *parts: object) -> Path:
    stat = source.stat()
    key = "|".join(
        [str(source.resolve()), kind, f"{stat.st_mtime_ns}:{stat.st_size}"]
        + [str(part) for part in parts]
        + [str(TIMELINE_MEDIA_VERSION)]
    )
    digest = hashlib.sha256(key.encode()).hexdigest()
    return get_thumbnail_cache_dir() / "timeline" / digest[:2] / f"{digest}{THUMBNAIL_SUFFIX}"


def _cached(destination: Path, build) -> Path:
    if destination.is_file():
        return destination
    with _lock_for(str(destination)):
        if destination.is_file():
            return destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(
            dir=destination.parent, prefix="timeline-", suffix=PARTIAL_SUFFIX
        )
        os.close(descriptor)
        partial = Path(name)
        try:
            build(partial)
            if not partial.is_file() or partial.stat().st_size == 0:
                raise ThumbnailUnavailableError("ffmpeg produced no picture")
            os.replace(partial, destination)
        finally:
            partial.unlink(missing_ok=True)
    return destination


def filmstrip_times(start: float, end: float, count: int) -> list[float]:
    """The middle of each of ``count`` equal slices, so the strip never shows the cut frame."""
    span = max(0.0, end - start)
    return [start + span * (index + 0.5) / count for index in range(count)]


def filmstrip_command(
    executable: str, source: Path, destination: Path, times: list[float], height: int
) -> list[str]:
    """One fast seek per frame, scaled and laid side by side."""
    command = [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    for time in times:
        command += ["-ss", f"{time:.3f}", "-i", str(source)]
    scaled = "".join(
        f"[{index}:v]trim=end_frame=1,scale=-2:{height},setsar=1[f{index}];"
        for index in range(len(times))
    )
    if len(times) == 1:
        graph = f"{scaled}[f0]null[strip]"
    else:
        frames = "".join(f"[f{index}]" for index in range(len(times)))
        graph = f"{scaled}{frames}hstack=inputs={len(times)}[strip]"
    return [
        *command,
        "-filter_complex",
        graph,
        "-map",
        "[strip]",
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "70",
        "-f",
        "webp",
        str(destination),
    ]


def filmstrip(
    executable: str, source: Path, start: float, end: float, count: int, height: int
) -> Path:
    count = max(1, min(FILMSTRIP_MAX_FRAMES, count))
    height = max(FILMSTRIP_MIN_HEIGHT, min(FILMSTRIP_MAX_HEIGHT, height)) // 2 * 2
    times = filmstrip_times(start, end, count)
    destination = _cache_path(source, "filmstrip", f"{start:.2f}", f"{end:.2f}", count, height)
    return _cached(
        destination,
        lambda partial: run_ffmpeg(
            filmstrip_command(executable, source, partial, times, height),
            timeout=TIMELINE_MEDIA_TIMEOUT_SECONDS,
        ),
    )


def waveform_command(executable: str, source: Path, destination: Path, width: int) -> list[str]:
    """White on clear, like the gallery's: the timeline uses it as a mask and colors it."""
    graph = (
        f"[0:a:0]aformat=channel_layouts=mono,"
        f"showwavespic=s={width}x{WAVEFORM_HEIGHT}:colors=white:scale=sqrt,format=yuva420p[wave]"
    )
    return [
        executable,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        graph,
        "-map",
        "[wave]",
        "-frames:v",
        "1",
        "-c:v",
        "libwebp",
        "-quality",
        "80",
        "-f",
        "webp",
        str(destination),
    ]


def waveform(executable: str, source: Path, width: int) -> Path:
    width = max(WAVEFORM_MIN_WIDTH, min(WAVEFORM_MAX_WIDTH, width))
    destination = _cache_path(source, "waveform", width)
    return _cached(
        destination,
        lambda partial: run_ffmpeg(
            waveform_command(executable, source, partial, width),
            timeout=TIMELINE_MEDIA_TIMEOUT_SECONDS,
        ),
    )
