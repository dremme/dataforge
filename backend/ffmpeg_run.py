"""Shared ffmpeg runner. Polls so a cancel is noticed during a long encode, and drains pipes so ffmpeg cannot block."""

from __future__ import annotations

import logging
import subprocess
import threading
from collections.abc import Callable
from time import monotonic
from typing import BinaryIO

logger = logging.getLogger(__name__)

ShouldCancel = Callable[[], bool]
#: Position reached in the output, in seconds.
ProgressCallback = Callable[[float], None]

FFMPEG_POLL_SECONDS = 0.2
FFMPEG_TIMEOUT_SECONDS = 3600
FFMPEG_TERMINATE_SECONDS = 2.0
FFMPEG_READER_JOIN_SECONDS = 5.0

#: Both spellings carry microseconds; `out_time_ms` is a misnomer in ffmpeg, not milliseconds.
_PROGRESS_TIME_KEYS = ("out_time_us", "out_time_ms")


class FfmpegCancelled(Exception):
    """Raised when the caller cancels while ffmpeg is still running."""


def _terminate_ffmpeg(process: subprocess.Popen[bytes]) -> None:
    process.terminate()
    try:
        process.wait(timeout=FFMPEG_TERMINATE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()


def parse_progress_seconds(line: str) -> float | None:
    """Output position in seconds, or None. ffmpeg emits `N/A` until the first frame; that is not a fault."""
    key, separator, value = line.strip().partition("=")
    if not separator or key not in _PROGRESS_TIME_KEYS:
        return None

    try:
        microseconds = int(value)
    except ValueError:
        return None

    return max(0.0, microseconds / 1_000_000)


def _read_progress(pipe: BinaryIO, on_progress: ProgressCallback) -> None:
    for raw in pipe:
        seconds = parse_progress_seconds(raw.decode("utf-8", errors="replace"))
        if seconds is not None:
            on_progress(seconds)


def run_ffmpeg(
    command: list[str],
    *,
    should_cancel: ShouldCancel | None = None,
    on_progress: ProgressCallback | None = None,
    timeout: float = FFMPEG_TIMEOUT_SECONDS,
) -> None:
    """Raises on a non-zero exit, a timeout, or a cancel. ``on_progress`` requires ``-progress pipe:1``."""
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if on_progress else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise RuntimeError(f"Failed to run ffmpeg: {exc}") from exc

    stderr_pipe = process.stderr
    stdout_pipe = process.stdout
    stderr_output: list[bytes] = []

    with process:
        # Drained on threads: while we poll, a chatty ffmpeg would block on a full buffer.
        readers = [
            threading.Thread(
                target=lambda: stderr_output.append(stderr_pipe.read() if stderr_pipe else b"")
            )
        ]
        if on_progress and stdout_pipe:
            readers.append(threading.Thread(target=_read_progress, args=(stdout_pipe, on_progress)))
        for reader in readers:
            reader.start()

        deadline = monotonic() + timeout
        try:
            while True:
                try:
                    process.wait(timeout=FFMPEG_POLL_SECONDS)
                    break
                except subprocess.TimeoutExpired:
                    pass

                if should_cancel and should_cancel():
                    _terminate_ffmpeg(process)
                    raise FfmpegCancelled
                if monotonic() > deadline:
                    _terminate_ffmpeg(process)
                    raise RuntimeError("ffmpeg timed out")
        finally:
            for reader in readers:
                reader.join(timeout=FFMPEG_READER_JOIN_SECONDS)

    if process.returncode != 0:
        message = b"".join(stderr_output).decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "ffmpeg failed")
