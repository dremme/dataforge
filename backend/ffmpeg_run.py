"""Running ffmpeg, for every module that shells out to it.

Thumbnails aside, every ffmpeg call in this project is long enough that a cancelled
job must not have to wait it out, and chatty enough that its pipes must be drained by
someone. Both are handled here once rather than per caller.

The runner polls rather than blocking on ``wait``: ``run_media_job`` only checks for
cancellation between files, so a long encode would otherwise ignore the cancel
entirely, and a single-file caller has no other place to notice one at all.
"""

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

#: `-progress` writes `key=value` lines. Both spellings carry microseconds - `out_time_ms`
#: is a long-standing misnomer in ffmpeg itself, not a millisecond field.
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
    """The output position one ``-progress`` line reports, or None if it carries none.

    ffmpeg emits `N/A` for the position until the first frame lands, so a value that
    does not parse is a normal line rather than a fault.
    """
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
    """Run ``command``, raising on a non-zero exit, a timeout, or a cancel.

    ``on_progress`` requires the caller to have put ``-progress pipe:1`` in ``command``:
    the flag belongs next to the rest of the argv the caller is already building, and
    stdout is only opened as a pipe when someone is there to read it.
    """
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
        # Drained on threads: while we poll, nothing else reads the pipes, and a chatty
        # ffmpeg would block on a full buffer forever.
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
