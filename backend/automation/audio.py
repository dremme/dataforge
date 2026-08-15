"""Pulling a clip's audio track out for the vision request.

Only ``auto_caption`` uses this, and only when the job was started with audio
captioning on. Extraction lives here rather than in ``automation.vision`` for the same
reason GIF decoding lives in ``gif_frames``: shelling out to ffmpeg is its own concern,
and the request assembler should only ever see bytes.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from constants import VIDEO_EXTENSIONS
from ffmpeg_bin import ffmpeg_path

logger = logging.getLogger(__name__)

# What the local omni models actually accept today. The whole track is inlined in the
# same request as the keyframes, so an uncapped clip would build a payload the server
# rejects - three times over, once per retry.
AUDIO_MAX_SECONDS = 15
# What Qwen omni resamples to internally regardless of what it is sent, so sending it
# already at 16 kHz mono costs nothing and shrinks the payload by an order of magnitude.
AUDIO_SAMPLE_RATE = 16_000
AUDIO_CHANNELS = 1
# pcm_s16le in a WAV container: the one encoder every ffmpeg build has, and one of the
# two formats the OpenAI ``input_audio`` part accepts.
AUDIO_CODEC = "pcm_s16le"
AUDIO_FORMAT = "wav"

# A per-file call inside the job loop, so a wedged ffmpeg would hold the whole job.
FFMPEG_TIMEOUT_SECONDS = 60

# 44 bytes of RIFF header and nothing else is an empty track, not an audio track.
MIN_WAV_BYTES = 64


def _ffmpeg_command(executable: str, source: Path, destination: Path) -> list[str]:
    """Decode the first audio stream to a small mono WAV.

    ``-map 0:a:0`` is also the silence detector: a file with no audio stream fails the
    command outright, which saves a separate probe - and ``imageio-ffmpeg`` ships no
    ffprobe to run one with.
    """
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
    """The clip's opening ``AUDIO_MAX_SECONDS`` of audio as WAV, or ``None``.

    ``None`` covers every way this can come up empty - no ffmpeg, no audio stream, a
    decode failure, a timeout - because the caller treats them identically: caption the
    clip without audio and count it as a warning. Nothing here raises.
    """
    if media_path.suffix.lower() not in VIDEO_EXTENSIONS:
        # A GIF carries frames and no sound, and a still carries neither. Neither is
        # worth spawning a process to find that out. Auto-caption no longer sends a
        # GIF here at all - it counts as an image now - so this guard is defence
        # against a caller that has not caught up, not the path GIFs take.
        return None

    executable = ffmpeg or ffmpeg_path()
    if not executable:
        logger.warning("ffmpeg is unavailable; captioning %s without audio", media_path.name)
        return None

    # A temp directory rather than a pipe: WAV written to stdout carries an
    # unknown-size RIFF header that some decoders reject. And rather than a sibling
    # file, so a job never litters the user's dataset folder.
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
            # Overwhelmingly "this clip has no audio stream", which is expected input
            # rather than a fault, so it stays at debug and the stat carries the news.
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
