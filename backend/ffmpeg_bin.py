"""Locate ffmpeg. Returns ``None`` rather than raising so each caller can degrade on its own terms."""

from __future__ import annotations

import functools
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)


type FfmpegLocation = tuple[str, Literal["path", "bundled"]]

#: Earlier filters drop a frame's color matrix and range, so a video Apply strays from its preview.
MIN_VERSION = (7, 1)

_VERSION_TIMEOUT_SECONDS = 10
_VERSION_BANNER = re.compile(r"ffmpeg version n?(\d+)\.(\d+)")


def locate_ffmpeg() -> FfmpegLocation | None:
    """PATH, unless it predates ``MIN_VERSION`` and the wheel bundles one. Resolved per call."""
    found = shutil.which("ffmpeg")
    if found and _is_current(found):
        return found, "path"

    bundled = _bundled_ffmpeg()
    if bundled:
        return bundled, "bundled"
    if found:
        return found, "path"
    return None


def ffmpeg_path() -> str | None:
    location = locate_ffmpeg()
    return location[0] if location else None


def _bundled_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)
    return None


def _is_current(executable: str) -> bool:
    try:
        modified = Path(executable).stat().st_mtime_ns
    except OSError:
        return True
    version = _ffmpeg_version(executable, modified)
    return version is None or version >= MIN_VERSION


@functools.cache
def _ffmpeg_version(executable: str, _modified_ns: int) -> tuple[int, int] | None:
    """``None`` when the banner names no release, as a build from git does."""
    try:
        completed = subprocess.run(
            [executable, "-version"],
            capture_output=True,
            text=True,
            timeout=_VERSION_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = _VERSION_BANNER.search(completed.stdout)
    return (int(match[1]), int(match[2])) if match else None
