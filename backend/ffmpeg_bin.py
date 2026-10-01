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

PINNED_VERSION = (7, 1)

_VERSION_TIMEOUT_SECONDS = 10
_VERSION_BANNER = re.compile(r"^ffmpeg version n?(\d+)\.(\d+)(?:\.\d+)?(?=\s|[-_]|$)")


def locate_ffmpeg() -> FfmpegLocation | None:
    found = shutil.which("ffmpeg")
    if found and _is_pinned(found):
        return found, "path"

    bundled = _bundled_ffmpeg()
    if bundled and _is_pinned(bundled):
        return bundled, "bundled"
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


def _is_pinned(executable: str) -> bool:
    try:
        modified = Path(executable).stat().st_mtime_ns
    except OSError:
        return False
    version = _ffmpeg_version(executable, modified)
    return version == PINNED_VERSION


@functools.cache
def _ffmpeg_version(executable: str, _modified_ns: int) -> tuple[int, int] | None:
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
    if completed.returncode != 0:
        return None
    match = _VERSION_BANNER.search(completed.stdout)
    return (int(match[1]), int(match[2])) if match else None
