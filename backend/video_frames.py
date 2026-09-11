"""Frame-zero and frame-rate reads for a video, for scoring and for filling a workflow's rate node."""

from __future__ import annotations

import io
import logging
import re
import subprocess
from pathlib import Path

from PIL import Image

from constants import GIF_EXTENSION, IMAGE_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from folder_scan import get_media_type
from gif_frames import extract_gif_first_frame, gif_frame_rate
from video_edit import probe_source

logger = logging.getLogger(__name__)


def extract_video_first_frame(media: Path) -> Image.Image | None:
    """Opening frame as RGB, or None. Always ``release()``: an unopened capture still locks the file on Windows."""
    try:
        import cv2

        cap = cv2.VideoCapture(str(media))
    except Exception:
        logger.debug("No first frame for %s", media.name, exc_info=True)
        return None

    try:
        if not cap.isOpened():
            return None
        read, frame = cap.read()
    except Exception:
        logger.debug("No first frame for %s", media.name, exc_info=True)
        return None
    finally:
        cap.release()

    if not read or frame is None:
        return None

    return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))


def media_first_frame(media: Path, *, suffix: str | None = None) -> Image.Image | None:
    """Frame zero of whatever this is: a video's first decoded frame, a GIF's opening frame, or the still itself."""
    media_type = get_media_type(Path(f"media{suffix}")) if suffix else get_media_type(media)
    if media_type == "video":
        return extract_video_first_frame(media)
    if media_type == "gif":
        return extract_gif_first_frame(media)

    try:
        with Image.open(media) as opened:
            opened.load()
            return opened.convert("RGB")
    except Exception:
        logger.debug("No first frame for %s", media.name, exc_info=True)
        return None


def source_frame_rate(media: Path) -> float | None:
    """Frames per second, or None for a still and for anything unmeasurable."""
    media_type = get_media_type(media)
    if media_type == "video":
        return probe_source(media).frame_rate
    if media_type == "gif":
        # cv2 reports 0 fps for most GIFs, so the per-frame delays are the only real source.
        return gif_frame_rate(media)
    return None


def validate_candidate_media(media: Path, *, suffix: str | None = None) -> None:
    extension = (suffix or media.suffix).lower()
    try:
        if extension in IMAGE_EXTENSIONS or extension == GIF_EXTENSION:
            with Image.open(media) as opened:
                for frame in range(getattr(opened, "n_frames", 1)):
                    opened.seek(frame)
                    opened.load()
            return
        executable = ffmpeg_path()
        if executable is None:
            raise ValueError("FFmpeg is required to validate video candidates")
        result = subprocess.run(
            [
                executable,
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-i",
                str(media),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-c:v",
                "png",
                "pipe:1",
            ],
            capture_output=True,
            timeout=30,
            check=True,
        )
        with Image.open(io.BytesIO(result.stdout)) as opened:
            opened.load()
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("The candidate cannot be decoded as playable media") from error


def media_has_audio(media: Path, *, suffix: str | None = None) -> bool | None:
    extension = (suffix or media.suffix).lower()
    if extension in IMAGE_EXTENSIONS or extension == GIF_EXTENSION:
        return False
    executable = ffmpeg_path()
    if executable is None:
        return None
    try:
        result = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-i", str(media)],
            capture_output=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    metadata = result.stderr.decode("utf-8", errors="replace")
    if re.search(r"^\s*Stream #.*: Audio:", metadata, re.MULTILINE):
        return True
    if re.search(r"^\s*Stream #.*: Video:", metadata, re.MULTILINE):
        return False
    return None
