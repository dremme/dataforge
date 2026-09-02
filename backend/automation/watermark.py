"""Burn a text watermark into images and videos; originals stay untouched."""

from __future__ import annotations

import argparse
import logging
import re
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PIL import Image, ImageDraw, ImageFont

from automation.job_runner import CANCELLED, FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.strip_metadata import strip_file_metadata
from constants import VIDEO_EXTENSIONS, WATERMARK_DIR_NAME, WATERMARK_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from image_io import ImageReadError, load_image_for_edit, save_image_preserving_format
from logging_config import configure_logging, log_job_summary

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]

WatermarkSizeName = Literal["small", "medium", "large"]
WatermarkOpacity = Literal[25, 50, 75]
WatermarkPosition = Literal["top", "center", "bottom"]


@dataclass(frozen=True)
class WatermarkSize:
    """How large the mark renders; ``stroke_px`` is pixels because ffmpeg ``borderw`` rejects ``h``."""

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
WATERMARK_STALE_MARKER = ".watermark-stale"

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


WatermarkCancelled = FfmpegCancelled
WatermarkReadError = ImageReadError


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
        raise ValueError("No JPG, PNG, WebP, BMP, MP4, MOV or M4V files found in folder")

    output_dir = folder / WATERMARK_DIR_NAME
    if output_dir.exists() and not output_dir.is_dir():
        raise ValueError(
            f'Cannot create the "{WATERMARK_DIR_NAME}" folder: a file with that name already exists.'
        )

    if resolve_watermark_font() is None:
        raise ValueError(FONT_MISSING_MESSAGE)


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

    # Direct fill paints opaque white on RGB and replaces alpha on RGBA; compositing blends.
    overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))
    ImageDraw.Draw(overlay).text(
        xy,
        text,
        font=font,
        anchor=anchor,
        fill=(255, 255, 255, text_alpha),
        stroke_width=size.stroke_px,
        stroke_fill=(0, 0, 0, stroke_alpha),
    )
    return Image.alpha_composite(base, overlay)


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
    base, source_mode, exif = load_image_for_edit(source)
    merged = _composite_watermark(
        base, text=text, font_path=font_path, size=size, alpha=alpha, position=position
    )
    save_image_preserving_format(
        merged, destination, suffix=destination.suffix, source_mode=source_mode, exif=exif
    )


def escape_drawtext_path(path: Path) -> str:
    """Escape a filesystem path for a filtergraph option value."""
    return str(path).replace("\\", "/").replace(":", "\\:")


def escape_drawtext_text(text: str) -> str:
    """Escape watermark text for a single-quoted ``drawtext`` value; backslashes first."""
    escaped = text.replace("\\", "\\\\")
    escaped = escaped.replace("'", "\\'")
    escaped = escaped.replace(":", "\\:")
    return escaped.replace("%", "\\%")


def _scaled_expression(minimum: int, scale: float) -> str:
    """``h * scale``, floored at ``minimum``. Escape the comma or it ends the filter."""
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
        # No -noautorotate: ffmpeg applies the display matrix ahead of the filter.
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
    run_ffmpeg(command, should_cancel=should_cancel)


def _stale_path(final_path: Path) -> Path:
    return final_path.with_name(f"{final_path.stem}{WATERMARK_STALE_MARKER}{final_path.suffix}")


def _sweep_temp_files(output_dir: Path) -> None:
    with suppress(OSError):
        for marker in (WATERMARK_TEMP_MARKER, WATERMARK_STALE_MARKER):
            for leftover in output_dir.glob(f"*{marker}.*"):
                leftover.unlink(missing_ok=True)


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
    strip_metadata: bool,
) -> str:
    """Write one watermarked copy and return whether it was an ``image`` or a ``video``."""
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

        if strip_metadata:
            # On the temp, not the published copy: a failed strip must not leave a marked
            # file behind that still carries the metadata the user asked to remove.
            strip_file_metadata(temp_path, ffmpeg=ffmpeg)

        final_path = output_dir / media_path.name
        publish_replacing(temp_path, final_path, _stale_path(final_path))
    finally:
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
    strip_metadata: bool = False,
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
                strip_metadata=strip_metadata,
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
    parser.add_argument(
        "--strip-metadata",
        action="store_true",
        help="Remove EXIF and container metadata from the watermarked copies",
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
            strip_metadata=args.strip_metadata,
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
