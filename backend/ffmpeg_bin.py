"""Locating the ffmpeg executable, for every module that shells out to it.

Thumbnails, watermarking, metadata stripping and audio extraction all need the same
answer, and all of them work without it - each degrades on its own terms when this
returns ``None``, so resolution is deliberately non-raising.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


def ffmpeg_path() -> str | None:
    """The ffmpeg to run, preferring one on PATH over the bundled wheel's copy.

    Resolved per call rather than cached: an install that adds ffmpeg while the server
    is up should start working without a restart, and ``shutil.which`` is cheap next to
    the process it precedes.
    """
    found = shutil.which("ffmpeg")
    if found:
        return found

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)

    return None
