"""One ffmpeg pass that composites a project from its source files.

Layers stack bottom up: the lowest video track first, and within a track later clips above
earlier ones, which is what makes a dissolve's incoming clip fade in over the outgoing one.
Every clip is offset onto the timeline with ``setpts`` and overlaid with ``eof_action=pass``, so
gaps stay black. Audio clips are delayed to their place and mixed over silence of the full length.

Titles and stills are drawn by Pillow into the render's workspace: the preview shows the same
title image, and a still's EXIF orientation is applied the way the gallery shows it.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from automation.watermark import resolve_watermark_font
from color_adjust import adjust_lut, is_adjust_identity, is_global_identity, write_cube
from image_io import displayed_image
from schemas import (
    VideoEditSpec,
    VideoProject,
    VideoProjectClip,
    VideoProjectExportSettings,
    VideoProjectFont,
    VideoProjectSource,
    VideoProjectTitle,
    VideoProjectTrack,
)
from system_fonts import find_face
from video_edit import (
    IDENTITY_EPSILON,
    StreamColor,
    atempo_chain,
    build_adjust_stage,
    definition_links,
)
from video_project import project_duration

#: Short side of the fixed-size presets; their long side is 16:9 of it.
SIZE_PRESET_SHORT_SIDES = {"720p": 720, "1080p": 1080}
WIDESCREEN = 16 / 9

AUDIO_SAMPLE_RATE = 48000

GRAPH_FILE_NAME = "graph.txt"


@dataclass(frozen=True, slots=True)
class QualityPreset:
    crf: int
    preset: str
    audio_bitrate: str


QUALITY_PRESETS = {
    "standard": QualityPreset(crf=20, preset="fast", audio_bitrate="192k"),
    "high": QualityPreset(crf=16, preset="slow", audio_bitrate="256k"),
    "small": QualityPreset(crf=27, preset="medium", audio_bitrate="128k"),
}

#: Line spacing of a multi-line title, as a fraction of its size.
TITLE_LINE_SPACING = 0.2


def _even(value: float) -> int:
    return max(2, round(value) // 2 * 2)


def _seconds(value: float) -> str:
    return f"{value:.6f}"


def project_orientation(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    if width < height:
        return "portrait"
    return "square"


def export_size(project: VideoProject, settings: VideoProjectExportSettings) -> tuple[int, int]:
    """Source size keeps the project's sides and only swaps or squares them for a different
    orientation; the presets fix the short side and make the long side 16:9 of it."""
    orientation = settings.orientation or project_orientation(project.width, project.height)
    if settings.size == "source":
        long_side = max(project.width, project.height)
        short_side = min(project.width, project.height)
    else:
        short_side = SIZE_PRESET_SHORT_SIDES[settings.size]
        long_side = round(short_side * WIDESCREEN)
    if orientation == "landscape":
        return _even(long_side), _even(short_side)
    if orientation == "portrait":
        return _even(short_side), _even(long_side)
    return _even(short_side), _even(short_side)


def _font(
    size: int, chosen: VideoProjectFont | None
) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """The chosen face when it is installed, otherwise the default one."""
    face = find_face(chosen.family, chosen.style) if chosen is not None else None
    if face is not None:
        try:
            return ImageFont.truetype(str(face.path), size, index=face.index)
        except OSError:
            pass
    path = resolve_watermark_font()
    if path is not None:
        try:
            return ImageFont.truetype(str(path), size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def render_title_image(title: VideoProjectTitle, width: int, height: int) -> Image.Image:
    """The whole canvas, transparent but for the text, so the layer needs no placement."""
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    text = title.text.rstrip()
    if not text.strip():
        return canvas

    size = max(4, round(title.size * height))
    font = _font(size, title.font)
    stroke = round(title.outline * size)
    spacing = round(size * TITLE_LINE_SPACING)
    draw = ImageDraw.Draw(canvas)
    left, top, right, bottom = draw.multiline_textbbox(
        (0, 0), text, font=font, align=title.align, spacing=spacing, stroke_width=stroke
    )
    box_width = right - left
    box_height = bottom - top
    shift = {"left": 0.0, "center": 0.5, "right": 1.0}[title.align]
    origin_x = title.x * width - box_width * shift - left
    origin_y = title.y * height - box_height / 2 - top
    draw.multiline_text(
        (origin_x, origin_y),
        text,
        font=font,
        fill=ImageColor.getrgb(title.color),
        align=title.align,
        spacing=spacing,
        stroke_width=stroke,
        stroke_fill=ImageColor.getrgb(title.outline_color),
    )
    return canvas


def visual_tracks_bottom_up(project: VideoProject) -> list[VideoProjectTrack]:
    return [track for track in reversed(project.tracks) if track.kind == "video"]


def audible_tracks(project: VideoProject) -> list[VideoProjectTrack]:
    """Solo wins over everything else; a muted track stays silent even when soloed."""
    audio = [track for track in project.tracks if track.kind == "audio"]
    soloed = any(track.solo for track in audio)
    return [track for track in audio if not track.muted and (track.solo or not soloed)]


def transition_overlaps(project: VideoProject) -> tuple[dict[str, float], dict[str, float]]:
    """Seconds of dissolve each clip fades in or out over, linked audio included."""
    clips = {clip.id: clip for clip in project.clips}
    fade_in: dict[str, float] = {}
    fade_out: dict[str, float] = {}
    for transition in project.transitions:
        first = clips[transition.from_clip_id]
        second = clips[transition.to_clip_id]
        overlap = first.end - second.start
        fade_in[second.id] = max(fade_in.get(second.id, 0.0), overlap)
        for audio_in in _linked_audio(project, second):
            for audio_out in _linked_audio(project, first):
                if audio_in.track_id == audio_out.track_id:
                    fade_in[audio_in.id] = max(fade_in.get(audio_in.id, 0.0), overlap)
                    fade_out[audio_out.id] = max(fade_out.get(audio_out.id, 0.0), overlap)
    return fade_in, fade_out


def _linked_audio(project: VideoProject, clip: VideoProjectClip) -> list[VideoProjectClip]:
    if clip.link_id is None:
        return []
    return [c for c in project.clips if c.link_id == clip.link_id and c.kind == "audio"]


def effective_fades(
    clip: VideoProjectClip, overlaps: tuple[dict[str, float], dict[str, float]]
) -> tuple[float, float]:
    fade_in = max(clip.fade_in, overlaps[0].get(clip.id, 0.0))
    fade_out = max(clip.fade_out, overlaps[1].get(clip.id, 0.0))
    return min(fade_in, clip.duration), min(fade_out, clip.duration)


def _even_part(size: int, fraction: float) -> int:
    """``trunc(size*f/2)*2`` on the six decimals the crop filter is given, as the quick editor."""
    return max(2, math.trunc(size * float(f"{fraction:.6f}") / 2) * 2)


def cropped_size(source_size: tuple[int, int], clip: VideoProjectClip) -> tuple[int, int]:
    width, height = source_size
    if clip.crop is None:
        return width, height
    return _even_part(width, clip.crop.width), _even_part(height, clip.crop.height)


def placed_size(
    frame: tuple[int, int], canvas: tuple[int, int], clip: VideoProjectClip
) -> tuple[int, int]:
    """Fit or fill the canvas, then the clip's own scale. The preview uses the same rule."""
    width, height = frame
    pick = min if clip.fit == "fit" else max
    factor = pick(canvas[0] / width, canvas[1] / height) * clip.transform.scale
    return max(2, round(width * factor)), max(2, round(height * factor))


@dataclass(slots=True)
class RenderInputs:
    """The input arguments, in order, and the label of each one's stream."""

    arguments: list[str]
    count: int = 0

    def add(self, *arguments: str) -> int:
        self.arguments += list(arguments)
        self.count += 1
        return self.count - 1


ColorProbe = Callable[[Path], StreamColor]


@dataclass(frozen=True, slots=True)
class RenderPlan:
    command: list[str]
    duration: float


def _visual_chain(
    clip: VideoProjectClip,
    index: int,
    input_label: str,
    project: VideoProject,
    frame: tuple[int, int],
    fades: tuple[float, float],
    color: StreamColor,
    workspace: Path,
) -> list[str]:
    """Links from one input to a positioned RGBA layer labelled ``layer{index}``."""
    links: list[str] = []
    head: list[str] = ["setpts=PTS-STARTPTS"]
    if clip.kind == "video":
        if abs(clip.speed - 1.0) > IDENTITY_EPSILON:
            head.append(f"setpts=PTS/{clip.speed:.6f}")
        head.append(f"fps={project.frame_rate:.6f}")
    head.append(f"trim=duration={_seconds(clip.duration)}")
    head.append("setpts=PTS-STARTPTS")

    if clip.kind != "title" and clip.crop is not None:
        crop = clip.crop
        # Even on every edge: a yuv420p source has no half chroma sample to cut on.
        head.append(
            f"crop=trunc(iw*{crop.width:.6f}/2)*2:trunc(ih*{crop.height:.6f}/2)*2:"
            f"trunc(iw*{crop.x:.6f}/2)*2:trunc(ih*{crop.y:.6f}/2)*2"
        )

    tail: list[str] = []
    stage_label = f"pre{index}"
    adjusted = clip.kind != "title" and not is_adjust_identity(clip.adjust)
    if adjusted:
        cube = f"clip{index}.cube"
        stage = build_adjust_stage(
            VideoEditSpec(adjust=clip.adjust),
            cropped_size(frame, clip),
            color=color,
            cube_name=cube,
        )
        if not is_global_identity(clip.adjust):
            write_cube(workspace / cube, adjust_lut(clip.adjust))
        head += stage.head
        if stage.definition is not None:
            links.append(f"[{input_label}]{','.join(head)}[{stage_label}]")
            links += definition_links(
                stage.definition, cropped_size(frame, clip), stage_label, f"def{index}", f"c{index}"
            )
            input_label = f"def{index}"
            head = []
        tail += stage.tail

    canvas = (project.width, project.height)
    if clip.kind == "title":
        tail.append(f"scale={canvas[0]}:{canvas[1]}")
    else:
        width, height = placed_size(cropped_size(frame, clip), canvas, clip)
        tail.append(f"scale={width}:{height}:flags=lanczos")
    tail.append("format=rgba")

    transform = clip.transform
    if clip.kind != "title" and abs(transform.rotation) > IDENTITY_EPSILON:
        radians = f"{math.radians(transform.rotation):.8f}"
        tail.append(f"rotate=a={radians}:ow=rotw({radians}):oh=roth({radians}):c=none")
    if transform.opacity < 1.0 - IDENTITY_EPSILON:
        tail.append(f"colorchannelmixer=aa={transform.opacity:.6f}")
    fade_in, fade_out = fades
    if fade_in > IDENTITY_EPSILON:
        tail.append(f"fade=t=in:st=0:d={_seconds(fade_in)}:alpha=1")
    if fade_out > IDENTITY_EPSILON:
        start = max(0.0, clip.duration - fade_out)
        tail.append(f"fade=t=out:st={_seconds(start)}:d={_seconds(fade_out)}:alpha=1")
    tail.append(f"setpts=PTS+{_seconds(clip.start)}/TB")

    links.append(f"[{input_label}]{','.join(head + tail)}[layer{index}]")
    return links


def _overlay_position(clip: VideoProjectClip, project: VideoProject) -> tuple[str, str]:
    if clip.kind == "title":
        return "0", "0"
    dx = clip.transform.x * project.width
    dy = clip.transform.y * project.height
    return f"(W-w)/2+{dx:.3f}", f"(H-h)/2+{dy:.3f}"


def _audio_chain(
    clip: VideoProjectClip, index: int, input_label: str, fades: tuple[float, float]
) -> str:
    filters = [
        f"aresample={AUDIO_SAMPLE_RATE}",
        "aformat=sample_fmts=fltp:channel_layouts=stereo",
        "asetpts=PTS-STARTPTS",
    ]
    if abs(clip.speed - 1.0) > IDENTITY_EPSILON:
        # atempo keeps the pitch; asetrate would not.
        filters.append(atempo_chain(clip.speed))
    filters.append(f"atrim=duration={_seconds(clip.duration)}")
    filters.append("asetpts=PTS-STARTPTS")
    if abs(clip.gain - 1.0) > IDENTITY_EPSILON:
        filters.append(f"volume={clip.gain:.6f}")
    fade_in, fade_out = fades
    if fade_in > IDENTITY_EPSILON:
        filters.append(f"afade=t=in:st=0:d={_seconds(fade_in)}")
    if fade_out > IDENTITY_EPSILON:
        start = max(0.0, clip.duration - fade_out)
        filters.append(f"afade=t=out:st={_seconds(start)}:d={_seconds(fade_out)}")
    delay = round(clip.start * 1000)
    if delay > 0:
        filters.append(f"adelay=delays={delay}:all=1")
    return f"[{input_label}]{','.join(filters)}[aud{index}]"


def _source_size(source: VideoProjectSource, project: VideoProject) -> tuple[int, int]:
    if source.width and source.height:
        return source.width, source.height
    return project.width, project.height


def build_render(
    project: VideoProject,
    folder: Path,
    output: Path,
    *,
    settings: VideoProjectExportSettings,
    executable: str,
    workspace: Path,
    probe_color: ColorProbe,
) -> RenderPlan:
    """Write the graph and every layer file into ``workspace``, where ffmpeg must run."""
    duration = project_duration(project)
    if duration <= 0:
        raise ValueError("The timeline is empty, so there is nothing to export")

    sources = {source.id: source for source in project.sources}
    tracks = {track.id: track for track in project.tracks}
    overlaps = transition_overlaps(project)
    inputs = RenderInputs(arguments=[])
    links: list[str] = []
    canvas = f"{project.width}x{project.height}"
    links.append(
        f"color=c=black:s={canvas}:r={project.frame_rate:.6f}:d={_seconds(duration)},"
        "format=yuv420p[base]"
    )

    base = "base"
    layer = 0
    for track in visual_tracks_bottom_up(project):
        if track.hidden:
            continue
        clips = sorted(
            (clip for clip in project.clips if clip.track_id == track.id),
            key=lambda clip: clip.start,
        )
        for clip in clips:
            color = StreamColor()
            if clip.kind == "title":
                assert clip.title is not None
                still = workspace / f"title{layer}.png"
                render_title_image(clip.title, project.width, project.height).save(still)
                frame = (project.width, project.height)
                index = _still_input(inputs, still, clip, project)
            else:
                source = sources[clip.source_id or ""]
                path = folder / source.name
                frame = _source_size(source, project)
                if clip.kind == "image":
                    still = workspace / f"still{layer}.png"
                    with Image.open(path) as opened:
                        shown = displayed_image(opened)
                        frame = shown.size
                        shown.convert("RGBA").save(still)
                    index = _still_input(inputs, still, clip, project)
                else:
                    index = _video_input(inputs, path, clip, source)
                    if not is_adjust_identity(clip.adjust):
                        color = probe_color(path)
            links += _visual_chain(
                clip,
                layer,
                f"{index}:v",
                project,
                frame,
                effective_fades(clip, overlaps),
                color,
                workspace,
            )
            x, y = _overlay_position(clip, project)
            links.append(f"[{base}][layer{layer}]overlay=x={x}:y={y}:eof_action=pass[stack{layer}]")
            base = f"stack{layer}"
            layer += 1

    width, height = export_size(project, settings)
    finish = ["setsar=1"]
    if (width, height) != (project.width, project.height):
        finish = [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black",
            "setsar=1",
        ]
    links.append(f"[{base}]{','.join(finish)},format=yuv420p[vout]")

    links.append(
        f"anullsrc=r={AUDIO_SAMPLE_RATE}:cl=stereo,atrim=duration={_seconds(duration)}[silence]"
    )
    mixed = ["silence"]
    audible = {track.id for track in audible_tracks(project)}
    for clip in project.clips:
        if clip.kind != "audio" or clip.track_id not in audible or clip.gain <= IDENTITY_EPSILON:
            continue
        if tracks[clip.track_id].kind != "audio":
            continue
        source = sources[clip.source_id or ""]
        index = _audio_input(inputs, folder / source.name, clip)
        label = len(mixed)
        links.append(_audio_chain(clip, label, f"{index}:a", effective_fades(clip, overlaps)))
        mixed.append(f"aud{label}")
    if len(mixed) == 1:
        links.append("[silence]anull[aout]")
    else:
        streams = "".join(f"[{name}]" for name in mixed)
        links.append(
            f"{streams}amix=inputs={len(mixed)}:duration=first:dropout_transition=0:normalize=0,"
            f"atrim=duration={_seconds(duration)}[aout]"
        )

    (workspace / GRAPH_FILE_NAME).write_text(";\n".join(links), encoding="utf-8")

    quality = QUALITY_PRESETS[settings.quality]
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
        *inputs.arguments,
        "-/filter_complex",
        GRAPH_FILE_NAME,
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        quality.preset,
        "-crf",
        str(quality.crf),
        "-pix_fmt",
        "yuv420p",
        "-r",
        f"{project.frame_rate:.6f}",
        "-c:a",
        "aac",
        "-b:a",
        quality.audio_bitrate,
        "-ar",
        str(AUDIO_SAMPLE_RATE),
        "-t",
        _seconds(duration),
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        str(output),
    ]
    return RenderPlan(command=command, duration=duration)


def _still_input(
    inputs: RenderInputs, still: Path, clip: VideoProjectClip, project: VideoProject
) -> int:
    return inputs.add(
        "-loop",
        "1",
        "-framerate",
        f"{project.frame_rate:.6f}",
        "-t",
        _seconds(clip.duration),
        "-i",
        str(still),
    )


def _video_input(
    inputs: RenderInputs, path: Path, clip: VideoProjectClip, source: VideoProjectSource
) -> int:
    """Seeks half a source frame early, so the frame showing at ``source_in`` is the first kept."""
    half_frame = 0.5 / source.frame_rate if source.frame_rate else 0.0
    start = max(0.0, clip.source_in - half_frame)
    span = clip.duration * clip.speed + (clip.source_in - start) + half_frame
    arguments = ["-ss", _seconds(start)] if start > 0 else []
    return inputs.add(*arguments, "-t", _seconds(span), "-i", str(path))


def _audio_input(inputs: RenderInputs, path: Path, clip: VideoProjectClip) -> int:
    arguments = ["-ss", _seconds(clip.source_in)] if clip.source_in > 0 else []
    return inputs.add(*arguments, "-t", _seconds(clip.duration * clip.speed), "-i", str(path))
