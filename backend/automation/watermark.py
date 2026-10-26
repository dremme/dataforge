"""Burn a text and/or PNG watermark into images, GIFs and videos; originals stay untouched."""

from __future__ import annotations

import io
import re
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

from automation.job_runner import FileOutcome, ProgressCallback, run_media_job
from automation.selection import filter_media_list, list_folder_media
from automation.strip_metadata import strip_file_metadata
from constants import (
    GIF_EXTENSION,
    VIDEO_EXTENSIONS,
    WATERMARK_DIR_NAME,
    WATERMARK_EXTENSIONS,
)
from db import get_db_path
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from image_io import ImageReadError, load_image_for_edit, save_image_preserving_format
from schemas import WatermarkImageInfo

WatermarkSizeName = Literal["small", "medium", "large"]
WatermarkOpacity = Literal[25, 50, 75, 100]
WatermarkPosition = Literal["top_left", "top_right", "center", "bottom_left", "bottom_right"]


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
WATERMARK_OPACITIES: tuple[int, ...] = (25, 50, 75, 100)
WATERMARK_POSITIONS: tuple[WatermarkPosition, ...] = (
    "top_left",
    "top_right",
    "center",
    "bottom_left",
    "bottom_right",
)

#: The PNG fits a square of this fraction of the frame's shorter side, so a wide logo and a tall
#: one end up equally prominent, in landscape and portrait alike.
WATERMARK_IMAGE_SCALES: dict[str, float] = {"small": 0.10, "medium": 0.15, "large": 0.22}

DEFAULT_WATERMARK_SIZE: WatermarkSizeName = "medium"
DEFAULT_WATERMARK_OPACITY: WatermarkOpacity = 50
DEFAULT_WATERMARK_POSITION: WatermarkPosition = "bottom_right"
DEFAULT_WATERMARK_IMAGE_SIZE: WatermarkSizeName = "medium"
DEFAULT_WATERMARK_IMAGE_OPACITY: WatermarkOpacity = 100
DEFAULT_WATERMARK_IMAGE_POSITION: WatermarkPosition = "top_right"

WATERMARK_MARGIN_SCALE = 0.02
WATERMARK_MIN_FONT_PX = 12
WATERMARK_MIN_MARGIN_PX = 8
WATERMARK_IMAGE_MIN_PX = 16
# White at half opacity vanishes over a bright sky, so the mark carries a dark outline.
WATERMARK_STROKE_ALPHA_FACTOR = 0.7

MAX_WATERMARK_TEXT_LENGTH = 120
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")

WATERMARK_IMAGE_FILE_NAME = "watermark.png"
MAX_WATERMARK_IMAGE_BYTES = 20 * 1024 * 1024
MAX_WATERMARK_IMAGE_PIXELS = 40_000_000

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
FFMPEG_MISSING_MESSAGE = "ffmpeg is required to add a watermark to videos and GIFs"
NO_MARK_MESSAGE = "Turn on the text or the PNG watermark"
IMAGE_MISSING_MESSAGE = "Choose a PNG watermark first"
IMAGE_UNREADABLE_MESSAGE = "The stored PNG watermark cannot be read. Choose it again."
#: Names the PNG's settings in validation errors, since they share the text's options.
PNG_SUBJECT = "PNG watermark"


@dataclass(frozen=True)
class TextMark:
    text: str
    font_path: Path
    size: WatermarkSize
    alpha: float
    position: WatermarkPosition


@dataclass(frozen=True)
class ImageMark:
    """The PNG with its opacity already applied to the alpha channel, in memory for Pillow and
    on disk at ``path`` for ffmpeg."""

    image: Image.Image
    path: Path
    scale: float
    position: WatermarkPosition


def list_watermark_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, WATERMARK_EXTENSIONS, order="mtime")


def resolve_watermark_font() -> Path | None:
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        with suppress(OSError):
            if path.is_file():
                return path
    return None


def watermark_image_path() -> Path:
    """One PNG for the whole app, kept beside the database so it survives restarts."""
    return get_db_path().parent / WATERMARK_IMAGE_FILE_NAME


def read_watermark_image_info() -> WatermarkImageInfo:
    path = watermark_image_path()
    try:
        revision = path.stat().st_mtime_ns // 1000
        with Image.open(path) as opened:
            width, height = opened.size
    except OSError:
        return WatermarkImageInfo(available=False)
    return WatermarkImageInfo(available=True, width=width, height=height, revision=revision)


def save_watermark_image(stream: BinaryIO) -> WatermarkImageInfo:
    """Replace the stored PNG; anything but a decodable PNG within the limits is a ``ValueError``."""
    data = stream.read(MAX_WATERMARK_IMAGE_BYTES + 1)
    if len(data) > MAX_WATERMARK_IMAGE_BYTES:
        limit_mb = MAX_WATERMARK_IMAGE_BYTES // (1024 * 1024)
        raise ValueError(f"The PNG watermark cannot be larger than {limit_mb} MB")

    try:
        with Image.open(io.BytesIO(data)) as opened:
            image_format = opened.format
            pixels = opened.width * opened.height
            if image_format == "PNG" and pixels <= MAX_WATERMARK_IMAGE_PIXELS:
                # A full decode, so a truncated file is refused now rather than mid-job.
                opened.load()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("The file is not a readable PNG") from exc
    if image_format != "PNG":
        raise ValueError("The watermark must be a PNG file")
    if pixels > MAX_WATERMARK_IMAGE_PIXELS:
        limit_mp = MAX_WATERMARK_IMAGE_PIXELS // 1_000_000
        raise ValueError(f"The PNG watermark cannot be larger than {limit_mp} megapixels")

    target = watermark_image_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f"{target.stem}{WATERMARK_TEMP_MARKER}{target.suffix}")
    try:
        temp.write_bytes(data)
        # A starting job may be reading the old file, which a plain replace trips on on Windows.
        publish_replacing(temp, target, _stale_path(target))
    finally:
        with suppress(OSError):
            temp.unlink(missing_ok=True)
    return read_watermark_image_info()


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


def resolve_watermark_alpha(opacity: int, *, subject: str = "Watermark") -> float:
    if opacity not in WATERMARK_OPACITIES:
        options = ", ".join(str(value) for value in WATERMARK_OPACITIES)
        raise ValueError(f"{subject} opacity must be one of: {options}")
    return opacity / 100


def resolve_watermark_position(position: str, *, subject: str = "Watermark") -> WatermarkPosition:
    for option in WATERMARK_POSITIONS:
        if position == option:
            return option
    options = ", ".join(WATERMARK_POSITIONS)
    raise ValueError(f"{subject} position must be one of: {options}")


def resolve_watermark_image_scale(size: str) -> float:
    resolved = WATERMARK_IMAGE_SCALES.get(size)
    if resolved is None:
        raise ValueError(f"PNG watermark size must be one of: {', '.join(WATERMARK_IMAGE_SCALES)}")
    return resolved


def _pillow_anchor_and_xy(
    width: int, height: int, margin: int, position: WatermarkPosition
) -> tuple[str, tuple[int, int]]:
    """Pillow text anchor and point for the chosen position."""
    if position == "center":
        return "mm", (width // 2, height // 2)
    left = position.endswith("left")
    top = position.startswith("top")
    anchor = ("l" if left else "r") + ("t" if top else "d")
    return anchor, (margin if left else width - margin, margin if top else height - margin)


def _drawtext_xy(margin: str, position: WatermarkPosition) -> tuple[str, str]:
    """ffmpeg ``x`` and ``y`` expressions for the chosen position."""
    if position == "center":
        return "x=(w-tw)/2", "y=(h-th)/2"
    x = f"x={margin}" if position.endswith("left") else f"x=w-tw-({margin})"
    y = f"y={margin}" if position.startswith("top") else f"y=h-th-({margin})"
    return x, y


def _image_mark_xy(
    frame: tuple[int, int], mark: tuple[int, int], margin: int, position: WatermarkPosition
) -> tuple[int, int]:
    """Top-left corner of the PNG on the frame."""
    (width, height), (mark_width, mark_height) = frame, mark
    if position == "center":
        return (width - mark_width) // 2, (height - mark_height) // 2
    x = margin if position.endswith("left") else width - mark_width - margin
    y = margin if position.startswith("top") else height - mark_height - margin
    return x, y


def _overlay_xy(margin: str, position: WatermarkPosition) -> tuple[str, str]:
    """ffmpeg ``overlay`` expressions; ``W``/``H`` are the frame, ``w``/``h`` the PNG."""
    if position == "center":
        return "x=(W-w)/2", "y=(H-h)/2"
    x = f"x={margin}" if position.endswith("left") else f"x=W-w-({margin})"
    y = f"y={margin}" if position.startswith("top") else f"y=H-h-({margin})"
    return x, y


def validate_watermark_folder(
    folder: Path,
    *,
    text_enabled: bool = True,
    text: str = "",
    size: str = DEFAULT_WATERMARK_SIZE,
    opacity: int = DEFAULT_WATERMARK_OPACITY,
    position: str = DEFAULT_WATERMARK_POSITION,
    image_enabled: bool = False,
    image_size: str = DEFAULT_WATERMARK_IMAGE_SIZE,
    image_opacity: int = DEFAULT_WATERMARK_IMAGE_OPACITY,
    image_position: str = DEFAULT_WATERMARK_IMAGE_POSITION,
    selected_paths: list[Path] | None = None,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if folder.name == WATERMARK_DIR_NAME:
        raise ValueError(
            f'Cannot add a watermark inside the "{WATERMARK_DIR_NAME}" folder. '
            "Open the parent folder and run the job there."
        )

    if not text_enabled and not image_enabled:
        raise ValueError(NO_MARK_MESSAGE)
    if text_enabled:
        normalize_watermark_text(text)
        resolve_watermark_size(size)
        resolve_watermark_alpha(opacity)
        resolve_watermark_position(position)
    if image_enabled:
        resolve_watermark_image_scale(image_size)
        resolve_watermark_alpha(image_opacity, subject=PNG_SUBJECT)
        resolve_watermark_position(image_position, subject=PNG_SUBJECT)
        if not watermark_image_path().is_file():
            raise ValueError(IMAGE_MISSING_MESSAGE)

    if not filter_media_list(list_watermark_files(folder), selected_paths):
        raise ValueError("No JPG, PNG, WebP, BMP, GIF, MP4, MOV or M4V files found in folder")

    output_dir = folder / WATERMARK_DIR_NAME
    if output_dir.exists() and not output_dir.is_dir():
        raise ValueError(
            f'Cannot create the "{WATERMARK_DIR_NAME}" folder: a file with that name already exists.'
        )

    if text_enabled and resolve_watermark_font() is None:
        raise ValueError(FONT_MISSING_MESSAGE)


def load_watermark_image(alpha: float) -> Image.Image:
    """The stored PNG as RGBA with ``alpha`` folded into its own transparency."""
    try:
        with Image.open(watermark_image_path()) as opened:
            mark = opened.convert("RGBA")
    except OSError as exc:
        raise ValueError(IMAGE_UNREADABLE_MESSAGE) from exc
    if alpha < 1:
        mark.putalpha(mark.getchannel("A").point(lambda value: round(value * alpha)))
    return mark


def _fit_image_mark(base_size: tuple[int, int], mark: ImageMark) -> Image.Image:
    box = max(WATERMARK_IMAGE_MIN_PX, round(min(base_size) * mark.scale))
    ratio = min(box / mark.image.width, box / mark.image.height)
    fitted = (
        max(1, round(mark.image.width * ratio)),
        max(1, round(mark.image.height * ratio)),
    )
    return mark.image.resize(fitted, Image.Resampling.LANCZOS)


def _composite_watermark(
    base: Image.Image, *, text: TextMark | None, image: ImageMark | None
) -> Image.Image:
    margin = max(WATERMARK_MIN_MARGIN_PX, round(base.height * WATERMARK_MARGIN_SCALE))
    merged = base

    # The PNG first, so the text stays legible where the two meet; ffmpeg draws in this order too.
    if image is not None:
        fitted = _fit_image_mark(base.size, image)
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        overlay.paste(fitted, _image_mark_xy(base.size, fitted.size, margin, image.position))
        merged = Image.alpha_composite(merged, overlay)

    if text is not None:
        font_px = max(WATERMARK_MIN_FONT_PX, round(base.height * text.size.font_scale))
        font = ImageFont.truetype(str(text.font_path), font_px)
        anchor, xy = _pillow_anchor_and_xy(base.width, base.height, margin, text.position)

        text_alpha = round(255 * text.alpha)
        stroke_alpha = round(text_alpha * WATERMARK_STROKE_ALPHA_FACTOR)

        # Direct fill paints opaque white on RGB and replaces alpha on RGBA; compositing blends.
        overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))
        ImageDraw.Draw(overlay).text(
            xy,
            text.text,
            font=font,
            anchor=anchor,
            fill=(255, 255, 255, text_alpha),
            stroke_width=text.size.stroke_px,
            stroke_fill=(0, 0, 0, stroke_alpha),
        )
        merged = Image.alpha_composite(merged, overlay)

    return merged


def watermark_image(
    source: Path, destination: Path, *, text: TextMark | None, image: ImageMark | None
) -> None:
    base, source_mode, exif = load_image_for_edit(source)
    merged = _composite_watermark(base, text=text, image=image)
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


def _scaled_expression(minimum: int, scale: float, length: str = "h") -> str:
    """``length * scale``, floored at ``minimum``. Escape the comma or it ends the filter."""
    return f"max({minimum}\\,{length}*{scale})"


def build_drawtext_filter(mark: TextMark) -> str:
    """The filter that burns the mark into every frame, hence no ``enable`` expression."""
    margin = _scaled_expression(WATERMARK_MIN_MARGIN_PX, WATERMARK_MARGIN_SCALE)
    stroke_alpha = mark.alpha * WATERMARK_STROKE_ALPHA_FACTOR
    x_expr, y_expr = _drawtext_xy(margin, mark.position)
    return (
        "drawtext="
        f"fontfile='{escape_drawtext_path(mark.font_path)}'"
        f":text='{escape_drawtext_text(mark.text)}'"
        # Without this, a '%' in the text is read as a strftime directive.
        ":expansion=none"
        f":fontsize={_scaled_expression(WATERMARK_MIN_FONT_PX, mark.size.font_scale)}"
        f":fontcolor=white@{mark.alpha:.2f}"
        f":borderw={mark.size.stroke_px}:bordercolor=black@{stroke_alpha:.2f}"
        f":{x_expr}"
        f":{y_expr}"
    )


def build_image_scale_filter(mark: ImageMark) -> str:
    """Fit the PNG to a square sized from the ``ref`` frame (``rw``/``rh``), which is already
    rotated for display, so no probe of the source is needed."""
    box = _scaled_expression(WATERMARK_IMAGE_MIN_PX, mark.scale, "min(rw\\,rh)")
    return f"scale=w={box}:h={box}:force_original_aspect_ratio=decrease:flags=lanczos"


def build_overlay_filter(mark: ImageMark) -> str:
    margin = _scaled_expression(WATERMARK_MIN_MARGIN_PX, WATERMARK_MARGIN_SCALE, "H")
    x_expr, y_expr = _overlay_xy(margin, mark.position)
    # The PNG input loops forever; `shortest` ends the output with the source.
    return f"overlay={x_expr}:{y_expr}:format=auto:shortest=1"


def build_mark_graph(text: TextMark | None, image: ImageMark | None) -> str:
    """Filtergraph from the source's first video stream to ``[marked]``; the PNG is input 1."""
    if text is None and image is None:
        raise ValueError(NO_MARK_MESSAGE)

    steps: list[str] = []
    current = "[0:v:0]"
    if image is not None:
        imaged = "[marked]" if text is None else "[imaged]"
        steps += [
            f"{current}split[base][ref]",
            f"[1:v][ref]{build_image_scale_filter(image)}[mark]",
            f"[base][mark]{build_overlay_filter(image)}{imaged}",
        ]
        current = imaged
    if text is not None:
        steps.append(f"{current}{build_drawtext_filter(text)}[marked]")
    return ";".join(steps)


def _image_input(image: ImageMark | None) -> list[str]:
    # A looped still, so the scale filter has a PNG frame for every source frame.
    return [] if image is None else ["-loop", "1", "-i", str(image.path)]


def watermark_video(
    source: Path,
    destination: Path,
    *,
    text: TextMark | None,
    image: ImageMark | None,
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
        *_image_input(image),
        # No -noautorotate: ffmpeg applies the display matrix ahead of the graph. With a second
        # input it still leaves the matrix on the frames, and players would rotate the
        # already-upright pixels a second time.
        "-filter_complex",
        f"{build_mark_graph(text, image)};[marked]sidedata=mode=delete:type=DISPLAYMATRIX[v]",
        # The first video and every audio track: default selection keeps only one audio stream,
        # but `-map 0` would pull in cover art (undrawable) and untyped subtitle/data streams.
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        # A batch job over copies, so it can afford slower and finer settings than the
        # interactive video editor, which encodes while the user waits.
        "-preset",
        "medium",
        "-crf",
        "16",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    run_ffmpeg(command, should_cancel=should_cancel)


def gif_loop_argument(source: Path) -> str:
    """ffmpeg's ``-loop`` for the source's loop count; the GIF demuxer does not carry it over."""
    try:
        with Image.open(source) as opened:
            loop = opened.info.get("loop")
    except (OSError, UnidentifiedImageError) as exc:
        raise ImageReadError(str(exc)) from exc
    # No NETSCAPE block means play once, which the muxer spells -1; 0 is forever in both.
    return "-1" if loop is None else str(loop)


def build_gif_watermark_command(
    source: Path,
    destination: Path,
    *,
    executable: str,
    text: TextMark | None,
    image: ImageMark | None,
    loop: str,
) -> list[str]:
    """Rebuild each frame's palette after drawing; one shared palette drops colours that only
    appear in later frames. Without the timing flags the muxer rounds per-frame delays."""
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
        *_image_input(image),
        "-filter_complex",
        f"{build_mark_graph(text, image)};"
        "[marked]split[frames][stats];"
        "[stats]palettegen=stats_mode=single[palette];"
        "[frames][palette]paletteuse=new=1",
        "-fps_mode",
        "passthrough",
        "-enc_time_base",
        "demux",
        "-loop",
        loop,
        "-f",
        "gif",
        str(destination),
    ]


def watermark_gif(
    source: Path,
    destination: Path,
    *,
    text: TextMark | None,
    image: ImageMark | None,
    ffmpeg: str | None = None,
    should_cancel: ShouldCancel | None = None,
) -> None:
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    command = build_gif_watermark_command(
        source,
        destination,
        executable=executable,
        text=text,
        image=image,
        loop=gif_loop_argument(source),
    )
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
    text: TextMark | None,
    image: ImageMark | None,
    ffmpeg: str | None,
    should_cancel: ShouldCancel | None,
    strip_metadata: bool,
) -> str:
    """Write one watermarked copy and return whether it was an ``image`` or a ``video``."""
    temp_path = output_dir / f"{media_path.stem}{WATERMARK_TEMP_MARKER}{media_path.suffix}"
    is_gif = media_path.suffix.lower() == GIF_EXTENSION

    try:
        if is_gif:
            watermark_gif(
                media_path,
                temp_path,
                text=text,
                image=image,
                ffmpeg=ffmpeg,
                should_cancel=should_cancel,
            )
            # An ffmpeg encode per frame, so it paces the job like a video.
            kind = "video"
        elif media_path.suffix.lower() in VIDEO_EXTENSIONS:
            watermark_video(
                media_path,
                temp_path,
                text=text,
                image=image,
                ffmpeg=ffmpeg,
                should_cancel=should_cancel,
            )
            kind = "video"
        else:
            watermark_image(media_path, temp_path, text=text, image=image)
            kind = "image"

        # ffmpeg's GIF muxer writes no comment or XMP blocks, so a GIF copy has nothing to strip.
        if strip_metadata and not is_gif:
            # On the temp, not the published copy: a failed strip must not leave a marked
            # file behind that still carries the metadata the user asked to remove.
            strip_file_metadata(temp_path, ffmpeg=ffmpeg, should_cancel=should_cancel)

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
    text_enabled: bool = True,
    text: str = "",
    size: str = DEFAULT_WATERMARK_SIZE,
    opacity: int = DEFAULT_WATERMARK_OPACITY,
    position: str = DEFAULT_WATERMARK_POSITION,
    image_enabled: bool = False,
    image_size: str = DEFAULT_WATERMARK_IMAGE_SIZE,
    image_opacity: int = DEFAULT_WATERMARK_IMAGE_OPACITY,
    image_position: str = DEFAULT_WATERMARK_IMAGE_POSITION,
    strip_metadata: bool = False,
    ffmpeg: str | None = None,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_watermark_folder(
        folder,
        text_enabled=text_enabled,
        text=text,
        size=size,
        opacity=opacity,
        position=position,
        image_enabled=image_enabled,
        image_size=image_size,
        image_opacity=image_opacity,
        image_position=image_position,
        selected_paths=selected_paths,
    )

    text_mark: TextMark | None = None
    if text_enabled:
        font_path = resolve_watermark_font()
        if font_path is None:
            raise RuntimeError(FONT_MISSING_MESSAGE)
        text_mark = TextMark(
            text=normalize_watermark_text(text),
            font_path=font_path,
            size=resolve_watermark_size(size),
            alpha=resolve_watermark_alpha(opacity),
            position=resolve_watermark_position(position),
        )

    media_files = filter_media_list(list_watermark_files(folder), selected_paths)
    resolved_ffmpeg = ffmpeg or ffmpeg_path()

    output_dir = folder / WATERMARK_DIR_NAME
    output_dir.mkdir(exist_ok=True)
    _sweep_temp_files(output_dir)

    # Outside the output folder, where no source name can collide with it.
    with tempfile.TemporaryDirectory(
        prefix="dataforge-watermark-", ignore_cleanup_errors=True
    ) as scratch:
        image_mark: ImageMark | None = None
        if image_enabled:
            # A snapshot: replacing the stored PNG mid-job must not change the files still to come.
            snapshot = Path(scratch) / WATERMARK_IMAGE_FILE_NAME
            loaded = load_watermark_image(
                resolve_watermark_alpha(image_opacity, subject=PNG_SUBJECT)
            )
            loaded.save(snapshot)
            image_mark = ImageMark(
                image=loaded,
                path=snapshot,
                scale=resolve_watermark_image_scale(image_size),
                position=resolve_watermark_position(image_position, subject=PNG_SUBJECT),
            )

        def process(media_path: Path) -> FileOutcome:
            try:
                kind = _watermark_file(
                    media_path,
                    output_dir,
                    text=text_mark,
                    image=image_mark,
                    ffmpeg=resolved_ffmpeg,
                    should_cancel=should_cancel,
                    strip_metadata=strip_metadata,
                )
                return FileOutcome(status="success", stats={"success": 1, f"{kind}_success": 1})
            except FfmpegCancelled:
                return FileOutcome.cancelled()
            except ImageReadError as exc:
                return FileOutcome.counted("read_error", exc)
            except RuntimeError as exc:
                return FileOutcome.counted("ffmpeg_error", exc)
            except OSError as exc:
                return FileOutcome.counted("write_error", exc)

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
