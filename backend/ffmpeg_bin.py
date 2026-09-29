"""Locate ffmpeg. Returns ``None`` rather than raising so each caller can degrade on its own terms."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)


type FfmpegLocation = tuple[str, Literal["path", "bundled"]]


def locate_ffmpeg() -> FfmpegLocation | None:
    """Prefer PATH over the bundled wheel. Resolved per call so a mid-run install is picked up."""
    found = shutil.which("ffmpeg")
    if found:
        return found, "path"

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled, "bundled"
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)

    return None


def ffmpeg_path() -> str | None:
    location = locate_ffmpeg()
    return location[0] if location else None
