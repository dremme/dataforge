from __future__ import annotations

import functools
import logging
import re
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

from schemas import FfmpegSource

logger = logging.getLogger(__name__)


type FfmpegLocation = tuple[str, FfmpegSource]

PINNED_VERSION = (7, 1)

FFMPEG_EXECUTABLE = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
#: Where setup unpacks its checksum-verified build; imageio-ffmpeg's bundle is 7.1.0, unpatched.
SETUP_FFMPEG_DIR = Path(__file__).resolve().parent.parent / ".ffmpeg" / "bin"

_VERSION_TIMEOUT_SECONDS = 10
_VERSION_BANNER = re.compile(r"^ffmpeg version n?(\d+)\.(\d+)(?:\.(\d+))?(?=\s|[-_]|$)")


def locate_ffmpeg() -> FfmpegLocation | None:
    """The most patched 7.1 build; a tie goes to setup's copy, then PATH, then the bundle."""
    best: FfmpegLocation | None = None
    best_patch = -1
    for executable, source in _candidates():
        version = _pinned_version(executable)
        if version is not None and version[2] > best_patch:
            best, best_patch = (executable, source), version[2]

    if best is not None and best_patch == 0:
        _warn_unpatched(best[0])
    return best


def ffmpeg_path() -> str | None:
    location = locate_ffmpeg()
    return location[0] if location else None


def _candidates() -> Iterator[FfmpegLocation]:
    setup = SETUP_FFMPEG_DIR / FFMPEG_EXECUTABLE
    if setup.is_file():
        yield str(setup), "setup"
    found = shutil.which("ffmpeg")
    if found:
        yield found, "path"
    bundled = _bundled_ffmpeg()
    if bundled:
        yield bundled, "bundled"


def _bundled_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)
    return None


@functools.cache
def _warn_unpatched(executable: str) -> None:
    logger.warning(
        "Using FFmpeg 7.1.0 at %s, which lacks the 7.1 security fixes. Re-run setup to install "
        "a patched 7.1 build.",
        executable,
    )


def _pinned_version(executable: str) -> tuple[int, int, int] | None:
    try:
        modified = Path(executable).stat().st_mtime_ns
    except OSError:
        return None
    version = _ffmpeg_version(executable, modified)
    return version if version is not None and version[:2] == PINNED_VERSION else None


def _is_pinned(executable: str) -> bool:
    return _pinned_version(executable) is not None


@functools.cache
def _ffmpeg_version(executable: str, _modified_ns: int) -> tuple[int, int, int] | None:
    """``(major, minor, patch)``; a banner without a patch number is patch 0."""
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
    if not match:
        return None
    return int(match[1]), int(match[2]), int(match[3] or 0)
