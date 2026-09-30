"""Trim, obscure, crop, retime, rescale and adjust one video in place from its untouched original."""

from __future__ import annotations

import logging
import math
import re
import subprocess
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from color_adjust import adjust_lut, is_adjust_identity, is_global_identity, write_cube
from color_detail import DefinitionParams, definition_params, is_detail_identity, noise_params
from constants import VIDEO_EDIT_MUXERS
from edit_sidecars import (
    ensure_backup,
    read_spec,
    restore_backup,
    stale_path_for,
    sweep_edit_temp_files,
    temp_path_for,
    write_spec,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import ProgressCallback, ShouldCancel, run_ffmpeg
from file_publish import publish_replacing
from media_dimensions import media_dimensions
from schemas import MaskRegion, VideoEditResponse, VideoEditSpec

logger = logging.getLogger(__name__)

FFMPEG_MISSING_MESSAGE = "ffmpeg is required to edit a video"

VIDEO_EDIT_TIMEOUT_SECONDS = 1800

#: `atempo` is only documented as well behaved inside this range.
MIN_ATEMPO = 0.5
MAX_ATEMPO = 2.0

IDENTITY_EPSILON = 1e-9

#: Above this a container is lying rather than reporting, so the rate is not used.
MAX_PLAUSIBLE_FPS = 1000.0

#: A mosaic block hides about as much as a Gaussian a quarter its size; one strength serves both.
BLUR_RADIUS_DIVISOR = 4

#: ffmpeg runs in the LUT's temp folder so the filter names a bare file: no filtergraph escaping.
ADJUST_CUBE_NAME = "adjust.cube"

#: A stream tagged with any of these names its own matrix; an untagged one is taken as BT.709.
_COLOR_MATRIX_TAGS = ("bt709", "bt470bg", "smpte170m", "bt2020", "smpte240m", "fcc", "ycgco")

_PROBE_TIMEOUT_SECONDS = 15


def read_edit_spec(media: Path) -> VideoEditSpec | None:
    return read_spec(media, VideoEditSpec)


def is_identity_spec(spec: VideoEditSpec) -> bool:
    return (
        not spec.masks
        and spec.crop is None
        and abs(spec.speed - 1.0) < IDENTITY_EPSILON
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
        and abs(spec.volume - 1.0) < IDENTITY_EPSILON
        and is_adjust_identity(spec.adjust)
        and spec.trim_start < IDENTITY_EPSILON
        and spec.trim_end is None
    )


def expected_output_seconds(
    spec: VideoEditSpec, source_seconds: float | None = None
) -> float | None:
    """``None`` only when neither the spec nor a probe knows where the render stops."""
    end = spec.trim_end if spec.trim_end is not None else source_seconds
    if end is None:
        return None
    return max(0.0, end - spec.trim_start) / spec.speed


@dataclass(frozen=True, slots=True)
class SourceProbe:
    frame_rate: float | None = None
    size: tuple[int, int] | None = None
    #: Runtime of the source, so an untrimmed retime still knows where the render ends.
    seconds: float | None = None


def probe_source(media: Path) -> SourceProbe:
    """Rate and frame size in one capture. Decoded rather than read from the header: the backup is
    named ``<name>.mp4.bak``, and a header reader gates on the suffix. Always ``release()``: an
    unopened capture still locks the file on Windows."""
    try:
        import cv2

        cap = cv2.VideoCapture(str(media))
    except Exception:
        # A read the editor opens on; without OpenCV it falls back rather than failing to open.
        logger.debug("No probe for %s", media.name, exc_info=True)
        return SourceProbe()

    try:
        if not cap.isOpened():
            return SourceProbe()
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
    except Exception:
        logger.debug("No probe for %s", media.name, exc_info=True)
        return SourceProbe()
    finally:
        cap.release()

    usable = math.isfinite(fps) and 0 < fps <= MAX_PLAUSIBLE_FPS
    counted = usable and math.isfinite(frames) and frames > 0
    return SourceProbe(
        frame_rate=fps if usable else None,
        size=(width, height) if width > 0 and height > 0 else None,
        seconds=frames / fps if counted else None,
    )


def resolve_muxer(media: Path) -> str:
    muxer = VIDEO_EDIT_MUXERS.get(media.suffix.lower())
    if muxer is None:
        raise ValueError(f"{media.suffix} videos cannot be edited")
    return muxer


def _seconds(value: float) -> str:
    return f"{value:.3f}"


def _fraction(value: float) -> str:
    return f"{value:.6f}"


def atempo_chain(speed: float) -> str:
    links: list[float] = []
    remaining = speed

    while remaining > MAX_ATEMPO:
        links.append(MAX_ATEMPO)
        remaining /= MAX_ATEMPO
    while remaining < MIN_ATEMPO:
        links.append(MIN_ATEMPO)
        remaining /= MIN_ATEMPO

    if abs(remaining - 1.0) > IDENTITY_EPSILON:
        links.append(remaining)

    return ",".join(f"atempo={_fraction(link)}" for link in links)


def _even(value: float) -> int:
    return int(value) // 2 * 2


def _even_part(size: int, fraction: float) -> int:
    """``trunc(size*f/2)*2`` on the same six-decimal ``f`` the crop and scale filters are given."""
    return math.trunc(size * float(_fraction(fraction)) / 2) * 2


def output_frame_size(source_size: tuple[int, int], spec: VideoEditSpec) -> tuple[int, int]:
    width, height = source_size
    if spec.crop is not None:
        width = _even_part(width, spec.crop.width)
        height = _even_part(height, spec.crop.height)
    if abs(spec.scale - 1.0) > IDENTITY_EPSILON:
        width = _even_part(width, spec.scale)
        height = _even_part(height, spec.scale)
    return width, height


def mask_box(size: tuple[int, int], region: MaskRegion) -> tuple[int, int, int, int]:
    """Even on every edge: ``yuv420p`` has no half chroma sample to put an odd crop on."""
    width, height = size
    left = min(_even(round(width * region.x)), max(0, width - 2))
    top = min(_even(round(height * region.y)), max(0, height - 2))
    right = min(_even(round(width * (region.x + region.width))), _even(width))
    bottom = min(_even(round(height * (region.y + region.height))), _even(height))
    return left, top, max(right, left + 2), max(bottom, top + 2)


def padded_box(
    size: tuple[int, int], box: tuple[int, int, int, int], pad: int
) -> tuple[int, int, int, int]:
    width, height = size
    left, top, right, bottom = box
    return (
        max(0, _even(left - pad)),
        max(0, _even(top - pad)),
        min(_even(width), _even(right + pad)),
        min(_even(height), _even(bottom + pad)),
    )


def mask_branch(size: tuple[int, int], region: MaskRegion) -> str:
    """One region, cut from the frame and handed back the same size for ``overlay`` to drop in."""
    box = mask_box(size, region)
    left, top, right, bottom = box
    box_width = right - left
    box_height = bottom - top
    cut = f"crop={box_width}:{box_height}:{left}:{top}"

    if region.mode == "blackout":
        return f"{cut},drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill"

    extent = region.strength * min(box_width, box_height)

    if region.mode == "pixelate":
        block = max(2, _even(round(extent)))
        columns = max(1, box_width // block)
        rows = max(1, box_height // block)
        return (
            f"{cut},scale={columns}:{rows}:flags=area,scale={box_width}:{box_height}:flags=neighbor"
        )

    # Blurred with real neighbours and trimmed back, or the patch edge shows as a seam.
    sigma = max(0.5, extent / BLUR_RADIUS_DIVISOR)
    outer = padded_box(size, box, math.ceil(sigma * 2))
    return (
        f"crop={outer[2] - outer[0]}:{outer[3] - outer[1]}:{outer[0]}:{outer[1]},"
        f"gblur=sigma={_fraction(sigma)},"
        f"crop={box_width}:{box_height}:{left - outer[0]}:{top - outer[1]}"
    )


def build_mask_filtergraph(spec: VideoEditSpec, size: tuple[int, int]) -> tuple[list[str], str]:
    """Regions are cut from the source before the crop, so they keep their place in the frame.
    Returns the graph's links and the label of the masked stream they end on."""
    regions = spec.masks
    cuts = "".join(f"[cut{index}]" for index in range(len(regions)))
    links = [f"[0:v]split={len(regions) + 1}[base]{cuts}"]
    for index, region in enumerate(regions):
        links.append(f"[cut{index}]{mask_branch(size, region)}[mask{index}]")

    stage = "base"
    for index, region in enumerate(regions):
        left, top, _, _ = mask_box(size, region)
        next_stage = f"over{index}"
        links.append(f"[{stage}][mask{index}]overlay={left}:{top}[{next_stage}]")
        stage = next_stage

    return links, stage


def build_audio_filters(spec: VideoEditSpec) -> str:
    """atempo for the retime, volume for the gain; muting drops the stream instead of filtering."""
    links: list[str] = []
    if abs(spec.speed - 1.0) > IDENTITY_EPSILON:
        links.append(atempo_chain(spec.speed))
    if spec.volume > IDENTITY_EPSILON and abs(spec.volume - 1.0) > IDENTITY_EPSILON:
        links.append(f"volume={_fraction(spec.volume)}")
    return ",".join(link for link in links if link)


def geometry_filters(spec: VideoEditSpec, frame_rate: float | None = None) -> list[str]:
    """Crop, scale and retime. Dimensions are even because ``yuv420p`` cannot express an odd one."""
    filters: list[str] = []

    crop = spec.crop
    if crop is not None:
        filters.append(
            "crop="
            f"trunc(iw*{_fraction(crop.width)}/2)*2:"
            f"trunc(ih*{_fraction(crop.height)}/2)*2:"
            f"trunc(iw*{_fraction(crop.x)}/2)*2:"
            f"trunc(ih*{_fraction(crop.y)}/2)*2"
        )

    if abs(spec.scale - 1.0) > IDENTITY_EPSILON:
        # Both axes, not `-2`: that rounds to even where this truncates, disagreeing by a pixel.
        filters.append(
            f"scale=trunc(iw*{_fraction(spec.scale)}/2)*2:trunc(ih*{_fraction(spec.scale)}/2)*2"
        )

    if abs(spec.speed - 1.0) > IDENTITY_EPSILON:
        filters.append(f"setpts=PTS/{_fraction(spec.speed)}")
        # setpts compresses timestamps and keeps every frame; pin fps so a 2x 24fps clip stays 24fps.
        if frame_rate is not None:
            filters.append(f"fps={_fraction(frame_rate)}")

    return filters


def definition_expression(params: DefinitionParams) -> str:
    """``lut2`` luma: ``x`` is the pixel, ``y`` its blurred base, both full-range 8-bit."""
    detail = "(x-y)/255"
    limited = f"({detail})/(1+abs({detail})/{_fraction(params.knee)})"
    midtones = "4*(x/255)*(1-x/255)"
    # lut2 truncates, so the half level makes it round.
    return f"'clip(x+255*{_fraction(params.gain)}*{limited}*{midtones}+0.5,0,255)'"


def definition_links(
    params: DefinitionParams, frame: tuple[int, int], source: str, target: str
) -> list[str]:
    """The base is blurred small and scaled back, as the image path and the preview take it."""
    small_width, small_height = params.size
    width, height = frame
    return [
        f"[{source}]split=2[defsrc][defbase]",
        f"[defbase]scale=w={small_width}:h={small_height}:flags=area,"
        f"gblur=sigma={_fraction(params.sigma)}:steps=4:planes=1,"
        f"scale=w={width}:h={height}:flags=bilinear[defblur]",
        f"[defsrc][defblur]lut2=c0={definition_expression(params)}:c1=x:c2=x[{target}]",
    ]


@dataclass(frozen=True, slots=True)
class AdjustStage:
    """Filters either side of definition, the one step that needs a graph."""

    head: list[str]
    definition: DefinitionParams | None
    tail: list[str]


@dataclass(frozen=True, slots=True)
class StreamColor:
    """How the source's pixels are to be read; the render hands them back the same way."""

    untagged: bool = False
    full_range: bool = False


def build_adjust_stage(
    spec: VideoEditSpec, frame: tuple[int, int] | None, *, color: StreamColor = StreamColor()
) -> AdjustStage:
    """Detail on full-range planes, then the LUT, then back to limited range for the encoder."""
    adjust = spec.adjust
    if is_adjust_identity(adjust):
        return AdjustStage([], None, [])

    head: list[str] = []
    tail: list[str] = []
    if color.untagged:
        # Browsers read an untagged stream as BT.709, and that is what the preview showed.
        head.append("setparams=colorspace=bt709")

    # Detail works on full-range planes; a limited-range source goes back to limited afterwards.
    ranged = not is_detail_identity(adjust) and not color.full_range
    if ranged:
        head.append("scale=out_range=full")

    if adjust.noise_reduction > IDENTITY_EPSILON:
        params = noise_params(adjust.noise_reduction)
        # guided truncates its output; at 8 bits that darkens every plane by half a level.
        head.append("format=yuv420p16le")
        head.append(f"guided=radius={params.luma_radius}:eps={params.luma_eps:.8f}:planes=1")
        # Chroma planes are half size in 4:2:0, so half the radius covers the same ground.
        chroma_radius = max(1, params.chroma_radius // 2)
        head.append(f"guided=radius={chroma_radius}:eps={params.chroma_eps:.8f}:planes=6")
        head.append("format=yuv420p")

    definition = None
    if adjust.definition > IDENTITY_EPSILON:
        if frame is None:
            raise RuntimeError(
                "The video's frame size could not be read, so its definition cannot be sized"
            )
        definition = definition_params(adjust.definition, frame)

    if not is_global_identity(adjust):
        # Float planes: swscale's 8-bit RGB round trip alone darkens by about a level.
        tail.append(f"format=gbrpf32le,lut3d=file={ADJUST_CUBE_NAME}:interp=trilinear")
    if ranged:
        tail.append("scale=out_range=limited,format=yuv420p")

    return AdjustStage(head, definition, tail)


def build_video_filters(
    spec: VideoEditSpec,
    frame_rate: float | None = None,
    *,
    source_size: tuple[int, int] | None = None,
    color: StreamColor = StreamColor(),
) -> tuple[str, bool]:
    """The video filters, and whether they need ``-filter_complex`` rather than ``-vf``."""
    frame = output_frame_size(source_size, spec) if source_size is not None else None
    stage = build_adjust_stage(spec, frame, color=color)
    head = geometry_filters(spec, frame_rate) + stage.head

    if not spec.masks and stage.definition is None:
        return ",".join(head + stage.tail), False

    links: list[str] = []
    source = "0:v"
    if spec.masks:
        if source_size is None:
            # Rendering the rest would hand back a file that looks edited but hides nothing.
            raise RuntimeError(
                "The video's frame size could not be read, so its blur cannot be placed"
            )
        links, source = build_mask_filtergraph(spec, source_size)

    if stage.definition is None or frame is None:
        links.append(f"[{source}]{','.join(head + stage.tail) or 'null'}[v]")
        return ";".join(links), True

    links.append(f"[{source}]{','.join(head) or 'null'}[pre]")
    links += definition_links(stage.definition, frame, "pre", "defined")
    links.append(f"[defined]{','.join(stage.tail) or 'null'}[v]")
    return ";".join(links), True


@lru_cache(maxsize=8)
def ffmpeg_filters(executable: str) -> frozenset[str]:
    """Names from ``-filters``, cached per binary: PATH may hold an older ffmpeg than the wheel."""
    try:
        result = subprocess.run(
            [executable, "-hide_banner", "-filters"],
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return frozenset()
    listing = result.stdout.decode("utf-8", errors="replace")
    return frozenset(re.findall(r"^\s*\S+\s+(\w+)\s", listing, re.MULTILINE))


def required_filters(spec: VideoEditSpec) -> set[str]:
    adjust = spec.adjust
    needed: set[str] = set()
    if not is_global_identity(adjust):
        needed.add("lut3d")
    if adjust.noise_reduction > IDENTITY_EPSILON:
        needed.add("guided")
    if adjust.definition > IDENTITY_EPSILON:
        needed.update({"gblur", "lut2"})
    return needed


def check_filters(executable: str, spec: VideoEditSpec) -> None:
    needed = required_filters(spec)
    if not needed:
        return
    missing = sorted(needed - ffmpeg_filters(executable))
    if missing:
        raise RuntimeError(
            f"This ffmpeg has no {', '.join(missing)} filter; the adjustments need ffmpeg 4.4 or newer"
        )


def probe_stream_color(executable: str, media: Path) -> StreamColor:
    """Matrix and range from ffmpeg's own stream summary, e.g. ``yuvj420p(pc, bt470bg/...)``."""
    try:
        result = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-i", str(media)],
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return StreamColor(untagged=True)
    summary = result.stderr.decode("utf-8", errors="replace")
    stream = re.search(r"^\s*Stream #.*: Video: .*$", summary, re.MULTILINE)
    if stream is None:
        return StreamColor(untagged=True)
    line = stream.group(0)
    return StreamColor(
        untagged=not any(tag in line for tag in _COLOR_MATRIX_TAGS),
        full_range="(pc" in line or "yuvj" in line,
    )


def build_video_edit_command(
    source: Path,
    destination: Path,
    spec: VideoEditSpec,
    *,
    executable: str,
    muxer: str,
    frame_rate: float | None = None,
    source_size: tuple[int, int] | None = None,
    color: StreamColor = StreamColor(),
) -> list[str]:
    """One pass. ``-ss``/``-t`` are input options so they are measured before ``setpts`` compresses time.

    Trim points name frame boundaries. ``-ss`` sits half a frame early, which puts it between
    two PTS values and leaves the first kept frame unambiguous. ``-t`` is then the take itself
    less half a frame, not the span from ``-ss``: after an input seek ffmpeg measures the
    duration from the first frame it decodes, so a span would hand that half frame to the tail
    and let the frame after the out point in. ``-to`` is no help - it was measured keeping one
    frame too many at several rates."""
    command = [
        executable,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-progress",
        "pipe:1",
        "-y",
    ]

    half_frame = 0.5 / frame_rate if frame_rate else 0.0
    start = max(0.0, spec.trim_start - half_frame)
    if start > 0:
        command += ["-ss", _seconds(start)]
    if spec.trim_end is not None:
        command += ["-t", _seconds(spec.trim_end - spec.trim_start - half_frame)]

    command += ["-i", str(source)]

    video_filters, complex_graph = build_video_filters(
        spec, frame_rate, source_size=source_size, color=color
    )

    muted = spec.volume <= IDENTITY_EPSILON

    # Regions and definition need `split`, which a linear `-vf` chain cannot express.
    if complex_graph:
        command += ["-filter_complex", video_filters, "-map", "[v]"]
    else:
        command += ["-map", "0:v:0"]
        if video_filters:
            command += ["-vf", video_filters]

    # Trailing `?`: no ffprobe, and an unmatched optional stream is not an error.
    if not muted:
        command += ["-map", "0:a:0?"]

    retimed = abs(spec.speed - 1.0) > IDENTITY_EPSILON
    trimmed = spec.trim_start > 0 or spec.trim_end is not None
    revoiced = not muted and abs(spec.volume - 1.0) > IDENTITY_EPSILON

    audio_filters = build_audio_filters(spec)
    if not muted and audio_filters:
        command += ["-af", audio_filters]

    command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]

    # Stream copy lands on a packet boundary; only an edit that leaves the audio alone copies it.
    if muted:
        command += ["-an"]
    elif retimed or trimmed or revoiced:
        command += ["-c:a", "aac", "-b:a", "192k"]
    else:
        command += ["-c:a", "copy"]

    # Unconditional: every muxer in `VIDEO_EDIT_MUXERS` accepts it. Matroska/asf/flv would not.
    command += ["-movflags", "+faststart"]

    command += ["-f", muxer, str(destination)]
    return command


def describe_edited(media: Path, *, has_backup: bool) -> VideoEditResponse:
    stat = media.stat()
    dimensions = media_dimensions(media, "video", stat.st_mtime_ns, stat.st_size)
    return VideoEditResponse(
        path=str(media),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        width=dimensions[0] if dimensions else None,
        height=dimensions[1] if dimensions else None,
        has_backup=has_backup,
    )


def apply_video_edit(
    media: Path,
    spec: VideoEditSpec,
    *,
    ffmpeg: str | None = None,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    probe: SourceProbe | None = None,
) -> VideoEditResponse:
    """Render ``spec`` from the original. On failure the live file is left byte-identical."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    muxer = resolve_muxer(media)
    sweep_edit_temp_files(media.parent)

    check_filters(executable, spec)

    source = ensure_backup(media)
    temp_path = temp_path_for(media)
    # Probed from the backup: the live file may already have been retimed or rescaled.
    probe = probe or probe_source(source)
    adjusted = not is_adjust_identity(spec.adjust)
    command = build_video_edit_command(
        source,
        temp_path,
        spec,
        executable=executable,
        muxer=muxer,
        frame_rate=probe.frame_rate,
        source_size=probe.size,
        color=probe_stream_color(executable, source) if adjusted else StreamColor(),
    )

    # A cancelled ffmpeg can still hold the cube open on Windows; the folder then goes later.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as workspace:
        if not is_global_identity(spec.adjust):
            write_cube(Path(workspace) / ADJUST_CUBE_NAME, adjust_lut(spec.adjust))
        try:
            run_ffmpeg(
                command,
                should_cancel=should_cancel,
                on_progress=on_progress,
                timeout=VIDEO_EDIT_TIMEOUT_SECONDS,
                cwd=Path(workspace),
            )
            publish_replacing(temp_path, media, stale_path_for(media))
        finally:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)

    write_spec(media, spec)
    return describe_edited(media, has_backup=True)


def revert_video_edit(media: Path) -> VideoEditResponse:
    restore_backup(media)

    return describe_edited(media, has_backup=False)
