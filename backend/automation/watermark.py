"""Burn a text watermark into images and videos at a chosen corner or the center.

Originals are never touched: every watermarked copy is written into a ``watermarked``
subfolder of the source folder, under the source's own filename.

The two rendering paths are kept in visual sync by one size table, whose scales are
fractions of the media's height. That is what lets the ffmpeg path use the ``h`` filter
variable and never probe a video's dimensions. Position is shared the same way: Pillow
anchors and ffmpeg ``x``/``y`` expressions always resolve to the same corner or center.

Palette PNGs come out truecolor: anti-aliased text cannot be expressed in the source's
palette, so there is nothing to preserve.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import subprocess
import threading
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Literal

from PIL import Image, ImageDraw, ImageFont, ImageOps

from automation.job_runner import CANCELLED, FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from constants import VIDEO_EXTENSIONS, WATERMARK_DIR_NAME, WATERMARK_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

WatermarkSizeName = Literal["small", "medium", "large"]
WatermarkOpacity = Literal[25, 50, 75]
# top = top-left, center = middle, bottom = bottom-right.
WatermarkPosition = Literal["top", "center", "bottom"]


@dataclass(frozen=True)
class WatermarkSize:
    """How large the mark renders, as fractions of the media's height.

    ``stroke_px`` is a plain pixel count because ffmpeg's ``borderw`` is the one
    drawtext option that rejects frame variables: ``borderw=h*0.003`` fails to parse.
    Only ``fontsize``, ``x`` and ``y`` get the expression evaluator.
    """

    font_scale: float
    stroke_px: int


WATERMARK_SIZES: dict[str, WatermarkSize] = {
    "small": WatermarkSize(font_scale=0.030, stroke_px=1),
    "medium": WatermarkSize(font_scale=0.045, stroke_px=2),
    "large": WatermarkSize(font_scale=0.065, stroke_px=3),
}
WATERMARK_OPACITIES: tuple[int, ...] = (25, 50, 75)
WATERMARK_POSITIONS: tuple[WatermarkPosition, ...] = ("top", "center", "bottom")

DEFAULT_WATERMARK_SIZE: WatermarkSizeName = "medium"
DEFAULT_WATERMARK_OPACITY: WatermarkOpacity = 50
DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom"

WATERMARK_MARGIN_SCALE = 0.02
WATERMARK_MIN_FONT_PX = 12
WATERMARK_MIN_MARGIN_PX = 8
# White at half opacity vanishes over a bright sky, so the mark carries a dark outline.
WATERMARK_STROKE_ALPHA_FACTOR = 0.7

MAX_WATERMARK_TEXT_LENGTH = 120
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")

WATERMARK_TEMP_MARKER = ".watermark-tmp"
# Destination displaced while open for streaming (see ``_publish_watermarked_file``).
WATERMARK_STALE_MARKER = ".watermark-stale"
JPEG_SUFFIXES = {".jpg", ".jpeg"}
JPEG_QUALITY = 92

FFMPEG_POLL_SECONDS = 0.2
FFMPEG_TIMEOUT_SECONDS = 3600
FFMPEG_TERMINATE_SECONDS = 2.0
FFMPEG_READER_JOIN_SECONDS = 5.0

FONT_CANDIDATES: tuple[str, ...] = (
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)

FONT_MISSING_MESSAGE = (
    "No usable system font was found for the watermark text. "
    "Install a TrueType font such as Arial or DejaVu Sans and try again."
)
FFMPEG_MISSING_MESSAGE = "ffmpeg is required to add a watermark to videos"


class WatermarkCancelled(Exception):
    """Raised when the job is cancelled while a file is still being written."""


class WatermarkReadError(Exception):
    """Raised when the source media cannot be decoded, as opposed to written."""


def list_watermark_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, WATERMARK_EXTENSIONS, order="mtime")


def resolve_watermark_font() -> Path | None:
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        with suppress(OSError):
            if path.is_file():
                return path
    return None


def normalize_watermark_text(text: str) -> str:
    """Validate the watermark text.

    Characters that are special to ffmpeg's filtergraph (``:``, ``'``, ``\\``, ``%``)
    are deliberately allowed: they are escaped at render time, never rejected. Control
    characters are the exception, because a line break renders as a real newline in
    drawtext but is measured differently by Pillow, so the two paths would disagree.
    """
    trimmed = (text or "").strip()
    if not trimmed:
        raise ValueError("Watermark text cannot be empty")
    if _CONTROL_CHARACTERS.search(trimmed):
        raise ValueError("Watermark text cannot contain line breaks or control characters")
    if len(trimmed) > MAX_WATERMARK_TEXT_LENGTH:
        raise ValueError(
            f"Watermark text cannot be longer than {MAX_WATERMARK_TEXT_LENGTH} characters"
        )
    return trimmed


def resolve_watermark_size(size: str) -> WatermarkSize:
    resolved = WATERMARK_SIZES.get(size)
    if resolved is None:
        raise ValueError(f"Watermark size must be one of: {', '.join(WATERMARK_SIZES)}")
    return resolved


def resolve_watermark_alpha(opacity: int) -> float:
    if opacity not in WATERMARK_OPACITIES:
        options = ", ".join(str(value) for value in WATERMARK_OPACITIES)
        raise ValueError(f"Watermark opacity must be one of: {options}")
    return opacity / 100


def resolve_watermark_position(position: str) -> WatermarkPosition:
    if position not in WATERMARK_POSITIONS:
        options = ", ".join(WATERMARK_POSITIONS)
        raise ValueError(f"Watermark position must be one of: {options}")
    return position  # type: ignore[return-value]


def _pillow_anchor_and_xy(
    width: int, height: int, margin: int, position: WatermarkPosition
) -> tuple[str, tuple[int, int]]:
    """Pillow text anchor and point for the chosen position."""
    if position == "top":
        return "lt", (margin, margin)
    if position == "center":
        return "mm", (width // 2, height // 2)
    return "rd", (width - margin, height - margin)


def _drawtext_xy(margin: str, position: WatermarkPosition) -> tuple[str, str]:
    """ffmpeg ``x`` and ``y`` expressions for the chosen position."""
    if position == "top":
        return f"x={margin}", f"y={margin}"
    if position == "center":
        return "x=(w-tw)/2", "y=(h-th)/2"
    return f"x=w-tw-({margin})", f"y=h-th-({margin})"


def validate_watermark_folder(
    folder: Path,
    *,
    text: str,
    size: str = DEFAULT_WATERMARK_SIZE,
    opacity: int = DEFAULT_WATERMARK_OPACITY,
    position: str = DEFAULT_WATERMARK_POSITION,
    selected_paths: list[Path] | None = None,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if folder.name == WATERMARK_DIR_NAME:
        raise ValueError(
            f'Cannot add a watermark inside the "{WATERMARK_DIR_NAME}" folder. '
            "Open the parent folder and run the job there."
        )

    normalize_watermark_text(text)
    resolve_watermark_size(size)
    resolve_watermark_alpha(opacity)
    resolve_watermark_position(position)

    if not filter_media_list(list_watermark_files(folder), selected_paths):
        raise ValueError("No JPG, PNG or MP4 files found in folder")

    output_dir = folder / WATERMARK_DIR_NAME
    if output_dir.exists() and not output_dir.is_dir():
        raise ValueError(
            f'Cannot create the "{WATERMARK_DIR_NAME}" folder: a file with that name already exists.'
        )

    if resolve_watermark_font() is None:
        raise ValueError(FONT_MISSING_MESSAGE)


def _load_image_for_watermark(source: Path) -> tuple[Image.Image, str, Image.Exif]:
    """Return the source as detached RGBA pixels, plus its original mode and EXIF.

    Everything that touches the file happens inside the ``with`` block and the result
    outlives the handle, so the destination write can never race a lock still held on
    a multi-frame JPEG or APNG. See ``automation/vision.py`` for the same hazard.
    """
    try:
        with Image.open(source) as opened:
            opened.load()
            # Rotates the pixels and drops the Orientation tag, so the mark lands in the
            # corner the viewer sees rather than the corner the sensor recorded.
            oriented = ImageOps.exif_transpose(opened) or opened
            return oriented.convert("RGBA"), oriented.mode, oriented.getexif()
    except OSError as exc:
        raise WatermarkReadError(str(exc)) from exc


def _composite_watermark(
    base: Image.Image,
    *,
    text: str,
    font_path: Path,
    size: WatermarkSize,
    alpha: float,
    position: WatermarkPosition,
) -> Image.Image:
    font_px = max(WATERMARK_MIN_FONT_PX, round(base.height * size.font_scale))
    margin = max(WATERMARK_MIN_MARGIN_PX, round(base.height * WATERMARK_MARGIN_SCALE))
    font = ImageFont.truetype(str(font_path), font_px)
    anchor, xy = _pillow_anchor_and_xy(base.width, base.height, margin, position)

    text_alpha = round(255 * alpha)
    stroke_alpha = round(text_alpha * WATERMARK_STROKE_ALPHA_FACTOR)

    # Drawing a translucent fill straight onto the base would paint opaque white on an
    # RGB image and replace the alpha channel on an RGBA one; compositing blends.
    overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))
    ImageDraw.Draw(overlay).text(
        xy,
        text,
        font=font,
        # Anchors keep descenders/ascenders inside the margin, matching ffmpeg's x/y.
        anchor=anchor,
        fill=(255, 255, 255, text_alpha),
        stroke_width=size.stroke_px,
        stroke_fill=(0, 0, 0, stroke_alpha),
    )
    return Image.alpha_composite(base, overlay)


def _save_watermarked_image(
    merged: Image.Image,
    destination: Path,
    *,
    source_mode: str,
    exif: Image.Exif,
) -> None:
    if destination.suffix.lower() in JPEG_SUFFIXES:
        # 4:4:4 rather than the default 4:2:0: chroma subsampling halves the resolution
        # of the thin white strokes and turns small text to mush.
        merged.convert("RGB").save(
            destination,
            format="JPEG",
            quality=JPEG_QUALITY,
            subsampling=0,
            optimize=True,
            **({"exif": exif.tobytes()} if exif else {}),
        )
        return

    keeps_alpha = source_mode in {"RGBA", "LA", "PA"} or (
        source_mode == "P" and "transparency" in merged.info
    )
    image = merged if keeps_alpha else merged.convert("RGB")
    image.save(destination, format="PNG", optimize=True)


def watermark_image(
    source: Path,
    destination: Path,
    *,
    text: str,
    font_path: Path,
    size: WatermarkSize,
    alpha: float,
    position: WatermarkPosition,
) -> None:
    base, source_mode, exif = _load_image_for_watermark(source)
    merged = _composite_watermark(
        base, text=text, font_path=font_path, size=size, alpha=alpha, position=position
    )
    _save_watermarked_image(merged, destination, source_mode=source_mode, exif=exif)


def escape_drawtext_path(path: Path) -> str:
    """Escape a filesystem path for a filtergraph option value.

    Backslashes become forward slashes (ffmpeg accepts them on Windows) so that only the
    drive letter's colon is left to escape.
    """
    return str(path).replace("\\", "/").replace(":", "\\:")


def escape_drawtext_text(text: str) -> str:
    """Escape watermark text for a single-quoted ``drawtext`` value.

    Backslashes go first, otherwise the escapes added below would be escaped again.
    """
    escaped = text.replace("\\", "\\\\")
    escaped = escaped.replace("'", "\\'")
    escaped = escaped.replace(":", "\\:")
    return escaped.replace("%", "\\%")


def _scaled_expression(minimum: int, scale: float) -> str:
    """``h * scale``, floored at ``minimum``. The comma is escaped or it ends the filter."""
    return f"max({minimum}\\,h*{scale})"


def build_drawtext_filter(
    *,
    text: str,
    font_path: Path,
    size: WatermarkSize,
    alpha: float,
    position: WatermarkPosition = DEFAULT_WATERMARK_POSITION,
) -> str:
    """The filter that burns the mark into every frame, hence no ``enable`` expression."""
    margin = _scaled_expression(WATERMARK_MIN_MARGIN_PX, WATERMARK_MARGIN_SCALE)
    stroke_alpha = alpha * WATERMARK_STROKE_ALPHA_FACTOR
    x_expr, y_expr = _drawtext_xy(margin, position)
    return (
        "drawtext="
        f"fontfile='{escape_drawtext_path(font_path)}'"
        f":text='{escape_drawtext_text(text)}'"
        # Without this, a '%' in the text is read as a strftime directive.
        ":expansion=none"
        f":fontsize={_scaled_expression(WATERMARK_MIN_FONT_PX, size.font_scale)}"
        f":fontcolor=white@{alpha:.2f}"
        f":borderw={size.stroke_px}:bordercolor=black@{stroke_alpha:.2f}"
        f":{x_expr}"
        f":{y_expr}"
    )


def _terminate_ffmpeg(process: subprocess.Popen[bytes]) -> None:
    process.terminate()
    try:
        process.wait(timeout=FFMPEG_TERMINATE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()


def _run_ffmpeg(command: list[str], *, should_cancel: ShouldCancel | None) -> None:
    """Run ffmpeg, polling so a cancelled job does not have to wait out an encode.

    ``run_media_job`` only checks for cancellation between files, so a long encode would
    otherwise ignore the cancel entirely.
    """
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise RuntimeError(f"Failed to run ffmpeg: {exc}") from exc

    stderr_pipe = process.stderr
    stderr_output: list[bytes] = []

    with process:
        # Drained on a thread: while we poll, nothing else reads the pipe, and a chatty
        # ffmpeg would block on a full buffer forever.
        reader = threading.Thread(
            target=lambda: stderr_output.append(stderr_pipe.read() if stderr_pipe else b"")
        )
        reader.start()
        deadline = monotonic() + FFMPEG_TIMEOUT_SECONDS
        try:
            while True:
                try:
                    process.wait(timeout=FFMPEG_POLL_SECONDS)
                    break
                except subprocess.TimeoutExpired:
                    pass

                if should_cancel and should_cancel():
                    _terminate_ffmpeg(process)
                    raise WatermarkCancelled
                if monotonic() > deadline:
                    _terminate_ffmpeg(process)
                    raise RuntimeError("ffmpeg timed out while adding the watermark")
        finally:
            reader.join(timeout=FFMPEG_READER_JOIN_SECONDS)

    if process.returncode != 0:
        message = b"".join(stderr_output).decode("utf-8", errors="replace").strip()
        raise RuntimeError(message or "ffmpeg failed to add the watermark")


def watermark_video(
    source: Path,
    destination: Path,
    *,
    text: str,
    font_path: Path,
    size: WatermarkSize,
    alpha: float,
    position: WatermarkPosition,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> None:
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    command = [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        # No -noautorotate: ffmpeg applies the display matrix ahead of the filter, which
        # is the video counterpart to exif_transpose on the image path.
        "-vf",
        build_drawtext_filter(
            text=text, font_path=font_path, size=size, alpha=alpha, position=position
        ),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    _run_ffmpeg(command, should_cancel=should_cancel)


def _sweep_temp_files(output_dir: Path) -> None:
    """Drop temp files a hard kill left behind; the folder is one the user browses."""
    with suppress(OSError):
        for marker in (WATERMARK_TEMP_MARKER, WATERMARK_STALE_MARKER):
            for leftover in output_dir.glob(f"*{marker}.*"):
                leftover.unlink(missing_ok=True)


def _publish_watermarked_file(temp_path: Path, final_path: Path) -> None:
    """Move the finished temp file onto the public output name.

    ``os.replace`` onto a path the gallery is still streaming fails on Windows
    with WinError 5, even when the open handle shares delete
    (see ``media_file_response``). Renaming that open destination out of the
    way first succeeds, so the new file can take its name.
    """
    try:
        os.replace(temp_path, final_path)
        return
    except OSError:
        if not final_path.exists():
            raise

    stale_path = final_path.with_name(
        f"{final_path.stem}{WATERMARK_STALE_MARKER}{final_path.suffix}"
    )
    with suppress(OSError):
        stale_path.unlink(missing_ok=True)

    os.replace(final_path, stale_path)
    try:
        os.replace(temp_path, final_path)
    except OSError:
        with suppress(OSError):
            os.replace(stale_path, final_path)
        raise

    with suppress(OSError):
        stale_path.unlink(missing_ok=True)


def _watermark_file(
    media_path: Path,
    output_dir: Path,
    *,
    text: str,
    font_path: Path,
    size: WatermarkSize,
    alpha: float,
    position: WatermarkPosition,
    ffmpeg: str | None,
    should_cancel: ShouldCancel | None,
) -> str:
    """Write one watermarked copy and return whether it was an ``image`` or a ``video``."""
    # The real suffix is kept: ffmpeg picks its muxer from the extension.
    temp_path = output_dir / f"{media_path.stem}{WATERMARK_TEMP_MARKER}{media_path.suffix}"

    try:
        if media_path.suffix.lower() in VIDEO_EXTENSIONS:
            watermark_video(
                media_path,
                temp_path,
                text=text,
                font_path=font_path,
                size=size,
                alpha=alpha,
                position=position,
                ffmpeg=ffmpeg,
                should_cancel=should_cancel,
            )
            kind = "video"
        else:
            watermark_image(
                media_path,
                temp_path,
                text=text,
                font_path=font_path,
                size=size,
                alpha=alpha,
                position=position,
            )
            kind = "image"

        _publish_watermarked_file(temp_path, output_dir / media_path.name)
    finally:
        # A no-op once the replace above succeeded.
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    return kind


def run_watermark_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    text: str = "",
    size: str = DEFAULT_WATERMARK_SIZE,
    opacity: int = DEFAULT_WATERMARK_OPACITY,
    position: str = DEFAULT_WATERMARK_POSITION,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_watermark_folder(
        folder,
        text=text,
        size=size,
        opacity=opacity,
        position=position,
        selected_paths=selected_paths,
    )

    watermark_text = normalize_watermark_text(text)
    watermark_size = resolve_watermark_size(size)
    alpha = resolve_watermark_alpha(opacity)
    watermark_position = resolve_watermark_position(position)

    font_path = resolve_watermark_font()
    if font_path is None:
        raise RuntimeError(FONT_MISSING_MESSAGE)

    media_files = filter_media_list(list_watermark_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    output_dir = folder / WATERMARK_DIR_NAME
    output_dir.mkdir(exist_ok=True)
    _sweep_temp_files(output_dir)

    def process(media_path: Path) -> FileOutcome:
        try:
            kind = _watermark_file(
                media_path,
                output_dir,
                text=watermark_text,
                font_path=font_path,
                size=watermark_size,
                alpha=alpha,
                position=watermark_position,
                ffmpeg=resolved_ffmpeg,
                should_cancel=should_cancel,
            )
            return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
        except WatermarkCancelled:
            return FileOutcome(status=CANCELLED, stats={"cancelled": 1}, stop=True)
        except WatermarkReadError as exc:
            return FileOutcome(
                status="read_error",
                stats={"read_error": 1},
                fields={"message": str(exc)},
            )
        except RuntimeError as exc:
            return FileOutcome(
                status="ffmpeg_error",
                stats={"ffmpeg_error": 1},
                fields={"message": str(exc)},
            )
        except OSError as exc:
            return FileOutcome(
                status="write_error",
                stats={"write_error": 1},
                fields={"message": str(exc)},
            )

    return run_media_job(
        folder,
        media_files,
        stats={
            "total": len(media_files),
            "success": 0,
            "image_success": 0,
            "video_success": 0,
            "read_error": 0,
            "write_error": 0,
            "ffmpeg_error": 0,
            "cancelled": 0,
        },
        process=process,
        on_progress=on_progress,
        should_cancel=should_cancel,
        # image_success and video_success are sub-stats of success and must not be counted.
        processed_stat_keys=("success", "read_error", "write_error", "ffmpeg_error"),
    )


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(
        description="Add a text watermark to the JPG, PNG and MP4 files in a folder.",
    )
    parser.add_argument("folder", type=Path, help="Folder containing media files")
    parser.add_argument("--text", required=True, help="Watermark text")
    parser.add_argument(
        "--size",
        choices=tuple(WATERMARK_SIZES),
        default=DEFAULT_WATERMARK_SIZE,
        help="Watermark size relative to the media height",
    )
    parser.add_argument(
        "--opacity",
        type=int,
        choices=WATERMARK_OPACITIES,
        default=DEFAULT_WATERMARK_OPACITY,
        help="Watermark opacity in percent",
    )
    parser.add_argument(
        "--position",
        choices=WATERMARK_POSITIONS,
        default=DEFAULT_WATERMARK_POSITION,
        help="Watermark position: top-left, center, or bottom-right",
    )
    args = parser.parse_args(argv)

    folder = args.folder.expanduser().resolve()
    try:
        result = run_watermark_job(
            folder,
            text=args.text,
            size=args.size,
            opacity=args.opacity,
            position=args.position,
        )
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(
        logger,
        result,
        stat_keys=(
            "success",
            "image_success",
            "video_success",
            "read_error",
            "write_error",
            "ffmpeg_error",
        ),
    )
    stats = result.get("stats") or {}
    if not isinstance(stats, dict):
        return 0
    failures = sum(
        int(stats.get(key) or 0) for key in ("read_error", "write_error", "ffmpeg_error")
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
