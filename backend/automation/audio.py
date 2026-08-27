"""Pull a clip's audio track out for a vision request."""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from constants import VIDEO_EXTENSIONS
from ffmpeg_bin import ffmpeg_path

logger = logging.getLogger(__name__)

# Uncapped audio is inlined with the keyframes and rejected (then retried) by the server.
AUDIO_MAX_SECONDS = 15
AUDIO_SAMPLE_RATE = 16_000
AUDIO_CHANNELS = 1
AUDIO_CODEC = "pcm_s16le"
AUDIO_FORMAT = "wav"

FFMPEG_TIMEOUT_SECONDS = 60

# A 44-byte RIFF header with no samples is an empty track.
MIN_WAV_BYTES = 64


def _ffmpeg_command(executable: str, source: Path, destination: Path) -> list[str]:
    """Decode the first audio stream to a small mono WAV; ``-map 0:a:0`` fails if there is none."""
    return [
        executable,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-map",
        "0:a:0",
        "-t",
        str(AUDIO_MAX_SECONDS),
        "-ac",
        str(AUDIO_CHANNELS),
        "-ar",
        str(AUDIO_SAMPLE_RATE),
        "-c:a",
        AUDIO_CODEC,
        "-f",
        AUDIO_FORMAT,
        str(destination),
    ]


def extract_audio_wav(media_path: Path, *, ffmpeg: str | None = None) -> bytes | None:
    """The clip's opening ``AUDIO_MAX_SECONDS`` of audio as WAV, or ``None`` (never raises)."""
    if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
        return None

    executable = ffmpeg or ffmpeg_path()
    if not executable:
        logger.warning("ffmpeg is unavailable; captioning %s without audio", media_path.name)
        return None

    # Temp dir, not a pipe: WAV-to-stdout uses an unknown-size RIFF header some decoders reject.
    with tempfile.TemporaryDirectory(prefix="dataforge-audio-") as workspace:
        destination = Path(workspace) / f"audio.{AUDIO_FORMAT}"
        try:
            completed = subprocess.run(
                _ffmpeg_command(executable, media_path, destination),
                capture_output=True,
                check=False,
                timeout=FFMPEG_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            logger.warning("Audio extraction timed out for %s", media_path.name)
            return None
        except OSError as exc:
            logger.warning("Failed to run ffmpeg for %s: %s", media_path.name, exc)
            return None

        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="replace").strip()
            logger.debug("No audio extracted from %s: %s", media_path.name, stderr)
            return None

        try:
            data = destination.read_bytes()
        except OSError as exc:
            logger.warning("Could not read extracted audio for %s: %s", media_path.name, exc)
            return None

    if len(data) < MIN_WAV_BYTES:
        logger.debug("Extracted audio for %s was empty", media_path.name)
        return None

    return data
