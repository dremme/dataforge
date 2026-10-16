"""A browser-playable copy of a source video the editor's preview cannot decode.

The copy is H.264/AAC in MP4, written beside the original under a new name; the original is never
touched, and the project is relinked to the copy by the editor. Frame timing passes through, so
every clip keeps showing the same frames.
"""

from __future__ import annotations

import tempfile
from contextlib import suppress
from pathlib import Path

from constants import VIDEO_PROJECT_COMPATIBLE_TAG
from ffmpeg_run import run_ffmpeg
from video_project_export import allocate_output_name, publish_new_file

COMPATIBLE_COPY_TIMEOUT_SECONDS = 1800
#: Visually lossless for generated footage; the copy stands in for the original in the export.
COMPATIBLE_COPY_CRF = 16
#: Not the export's temp suffix: a starting export sweeps those as crash leftovers.
COMPATIBLE_COPY_TEMP_SUFFIX = ".compat-tmp"


def build_compatible_copy(executable: str, source: Path, output: Path) -> list[str]:
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "error", "-y"),
        *("-i", str(source), "-map", "0:v:0", "-map", "0:a:0?"),
        *("-c:v", "libx264", "-preset", "medium", "-crf", str(COMPATIBLE_COPY_CRF)),
        *("-pix_fmt", "yuv420p", "-fps_mode", "passthrough"),
        *("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4", str(output)),
    ]


def make_compatible_copy(executable: str, source: Path) -> Path:
    """Returns the new file, ``<stem>-h264.mp4`` or the next free numbered name."""
    folder = source.parent
    name = allocate_output_name(folder, f"{source.stem}{VIDEO_PROJECT_COMPATIBLE_TAG}", set())
    output = folder / name
    temp_path = output.with_name(f"{name}{COMPATIBLE_COPY_TEMP_SUFFIX}")
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as workspace:
            run_ffmpeg(
                build_compatible_copy(executable, source, temp_path),
                timeout=COMPATIBLE_COPY_TIMEOUT_SECONDS,
                cwd=Path(workspace),
            )
        publish_new_file(temp_path, output)
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)
    return output
