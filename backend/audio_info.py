"""Audio length from a file's headers, via mutagen; nothing is decoded."""

from __future__ import annotations

import logging
from pathlib import Path

import mutagen
from mutagen import MutagenError

__all__ = ["audio_duration"]

logger = logging.getLogger(__name__)


def audio_duration(path: Path) -> float | None:
    """Seconds, or ``None`` when mutagen cannot identify the file or report a positive length."""
    try:
        audio = mutagen.File(path)
    except (MutagenError, OSError):
        logger.debug("No audio header for %s", path, exc_info=True)
        return None

    length = getattr(getattr(audio, "info", None), "length", None)
    if not isinstance(length, int | float) or length <= 0:
        return None
    return float(length)
