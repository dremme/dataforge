"""Write an MP4 beside a GIF, from that GIF's frames.

A conversion, not an edit: the GIF is left exactly as it was and the result takes the
sibling name - ``loop.gif`` produces ``loop.mp4``. That naming is the point rather than a
convenience. Caption sidecars are keyed on the stem, so the MP4 inherits ``loop.txt``
without anything having to copy it, and the pair stays one captioned subject in two
encodings instead of two half-captioned files.

The rate is pinned to ``GIF_MP4_FRAME_RATE`` for every file, applied as an ``fps`` filter
rather than as an input rate. That distinction is the whole of the timing story: a GIF
carries a delay per frame and may vary it frame by frame, so the filter reads those
timestamps and lays evenly spaced frames over the same wall-clock duration, repeating or
dropping as the delays require. Forcing the rate on the input instead would discard the
delays and replay a 10 fps animation at 2.4x speed.
"""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from constants import GIF_MP4_EXTENSION, GIF_MP4_FRAME_RATE
from edit_sidecars import stale_path_for, sweep_edit_temp_files, temp_path_for
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from schemas import GifToMp4Response, GifToMp4StateResponse

FFMPEG_MISSING_MESSAGE = "ffmpeg is required to convert a GIF"

#: Generous next to any real animation, short enough that a wedged encode is not a leak.
GIF_TO_MP4_TIMEOUT_SECONDS = 900


def mp4_target_for(media: Path) -> Path:
    """``loop.gif`` -> ``loop.mp4``, in the same folder."""
    return media.with_suffix(GIF_MP4_EXTENSION)


def read_gif_to_mp4_state(media: Path) -> GifToMp4StateResponse:
    """Where the MP4 would land, and whether something already holds that name.

    Asked before the conversion runs so the click can prompt ahead of an overwrite
    rather than report one afterwards.
    """
    target = mp4_target_for(media)

    return GifToMp4StateResponse(
        path=str(media),
        target=str(target),
        target_exists=target.is_file(),
    )


def build_gif_to_mp4_command(
    source: Path,
    destination: Path,
    *,
    executable: str,
    frame_rate: float = GIF_MP4_FRAME_RATE,
) -> list[str]:
    """One pass: resample to ``frame_rate`` and encode as H.264.

    ``scale`` is unconditional because ``yuv420p`` cannot express an odd dimension and a
    GIF is under no obligation to have even ones. Truncating costs at most one row or
    column; refusing odd sizes outright would reject perfectly ordinary files.
    """
    return [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-vf",
        f"fps={frame_rate:.6f},scale=trunc(iw/2)*2:trunc(ih/2)*2",
        # A GIF has no audio track to map, and saying so keeps a mislabelled file that
        # turns out to carry one from producing an MP4 the GIF never sounded like.
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(destination),
    ]


def convert_gif_to_mp4(
    media: Path,
    *,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> GifToMp4Response:
    """Encode ``media`` into the MP4 beside it, replacing one that is already there.

    The encode lands on a temp file and is published over the target only once ffmpeg
    has exited cleanly, so a failure leaves an existing MP4 byte-identical rather than
    truncated - and the GIF itself is only ever read.
    """
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    target = mp4_target_for(media)
    sweep_edit_temp_files(target.parent)

    temp_path = temp_path_for(target)
    command = build_gif_to_mp4_command(media, temp_path, executable=executable)

    try:
        run_ffmpeg(command, should_cancel=should_cancel, timeout=GIF_TO_MP4_TIMEOUT_SECONDS)
        publish_replacing(temp_path, target, stale_path_for(target))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    stat = target.stat()
    return GifToMp4Response(
        path=str(target),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        frame_rate=GIF_MP4_FRAME_RATE,
    )
