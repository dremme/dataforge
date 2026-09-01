"""Trim, obscure, crop, retime and rescale one video in place from its untouched original."""

from __future__ import annotations

import logging
import math
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

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


def read_edit_spec(media: Path) -> VideoEditSpec | None:
    return read_spec(media, VideoEditSpec)


def is_identity_spec(spec: VideoEditSpec) -> bool:
    return (
        not spec.masks
        and spec.crop is None
        and abs(spec.speed - 1.0) < IDENTITY_EPSILON
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
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
    import cv2

    cap = cv2.VideoCapture(str(media))
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


def build_mask_filtergraph(spec: VideoEditSpec, size: tuple[int, int], tail: str) -> str:
    """Regions are cut from the source before the crop, so they keep their place in the frame."""
    regions = spec.masks
    links = [f"[0:v]split={len(regions) + 1}[base]"]
    links[0] += "".join(f"[cut{index}]" for index in range(len(regions)))

    chain = [";".join(links)]
    for index, region in enumerate(regions):
        chain.append(f"[cut{index}]{mask_branch(size, region)}[mask{index}]")

    stage = "base"
    for index, region in enumerate(regions):
        left, top, _, _ = mask_box(size, region)
        next_stage = f"over{index}"
        chain.append(f"[{stage}][mask{index}]overlay={left}:{top}[{next_stage}]")
        stage = next_stage

    chain.append(f"[{stage}]{tail or 'null'}[v]")
    return ";".join(chain)


def build_video_filters(spec: VideoEditSpec, frame_rate: float | None = None) -> str:
    """Crop, then scale, then retime. Dimensions are even because ``yuv420p`` cannot express an odd one."""
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

    return ",".join(filters)


def build_video_edit_command(
    source: Path,
    destination: Path,
    spec: VideoEditSpec,
    *,
    executable: str,
    muxer: str,
    frame_rate: float | None = None,
    source_size: tuple[int, int] | None = None,
) -> list[str]:
    """One pass. ``-ss``/``-t`` are input options so they are measured before ``setpts`` compresses time."""
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

    if spec.trim_start > 0:
        command += ["-ss", _seconds(spec.trim_start)]
    if spec.trim_end is not None:
        command += ["-t", _seconds(spec.trim_end - spec.trim_start)]

    command += ["-i", str(source)]

    video_filters = build_video_filters(spec, frame_rate)
    if spec.masks and source_size is None:
        # Rendering the rest would hand back a file that looks edited but hides nothing.
        raise RuntimeError("The video's frame size could not be read, so its blur cannot be placed")

    # Regions need `split` and `overlay`, which a linear `-vf` chain cannot express.
    if spec.masks:
        command += ["-filter_complex", build_mask_filtergraph(spec, source_size, video_filters)]
        # Trailing `?`: no ffprobe, and an unmatched optional stream is not an error.
        command += ["-map", "[v]", "-map", "0:a:0?"]
    else:
        command += ["-map", "0:v:0", "-map", "0:a:0?"]
        if video_filters:
            command += ["-vf", video_filters]

    retimed = abs(spec.speed - 1.0) > IDENTITY_EPSILON
    trimmed = spec.trim_start > 0 or spec.trim_end is not None
    if retimed:
        command += ["-af", atempo_chain(spec.speed)]

    command += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]

    # Stream copy lands on a packet boundary; only an edit that neither trims nor retimes copies audio.
    if retimed or trimmed:
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

    source = ensure_backup(media)
    temp_path = temp_path_for(media)
    # Probed from the backup: the live file may already have been retimed or rescaled.
    probe = probe or probe_source(source)
    command = build_video_edit_command(
        source,
        temp_path,
        spec,
        executable=executable,
        muxer=muxer,
        frame_rate=probe.frame_rate,
        source_size=probe.size,
    )

    try:
        run_ffmpeg(
            command,
            should_cancel=should_cancel,
            on_progress=on_progress,
            timeout=VIDEO_EDIT_TIMEOUT_SECONDS,
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
