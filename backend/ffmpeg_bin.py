"""Locate ffmpeg. Returns ``None`` rather than raising so each caller can degrade on its own terms."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)


def ffmpeg_path() -> str | None:
    """Prefer PATH over the bundled wheel. Resolved per call so a mid-run install is picked up."""
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
