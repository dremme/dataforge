"""One ffmpeg pass that composites a project from its source files.

Layers stack bottom up: the lowest video track first, and within a track later clips above
earlier ones, which is what makes a dissolve's incoming clip fade in over the outgoing one.
Every clip is offset onto the timeline with ``setpts`` and overlaid with ``eof_action=pass``, so
gaps stay black. Audio clips are delayed to their place and summed per track, where the track's
gain and ducking apply, then the tracks are mixed over silence of the full length with the master
gain, then limited, and normalized first when asked, by the export's audio level setting.

Keyframed properties become expressions of each frame's time (see ``video_project_animation``):
scale is evaluated per frame and padded to a fixed box, because overlay and rotate expect frames
of one size, and opacity is set per frame by ``sendcmd``, since ``colorchannelmixer`` takes no
expression.

Titles and stills are drawn by Pillow into the render's workspace: the preview shows the same
title image, and a still's EXIF orientation is applied the way the gallery shows it.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

from automation.watermark import resolve_watermark_font
from color_adjust import adjust_lut, is_adjust_identity, is_global_identity, write_cube
from constants import (
    VIDEO_PROJECT_DUCK_RAMP_SECONDS,
    VIDEO_PROJECT_LOUDNESS_TARGET_LUFS,
    VIDEO_PROJECT_MIN_CLIP_SECONDS,
    VIDEO_PROJECT_QUALITY_PRESETS,
    VIDEO_PROJECT_TIME_EPSILON,
    VIDEO_PROJECT_TRUE_PEAK_CEILING_DB,
)
from image_io import displayed_image
from schemas import (
    VideoEditSpec,
    VideoProject,
    VideoProjectAudioLevel,
    VideoProjectClip,
    VideoProjectExportSettings,
    VideoProjectExportSpan,
    VideoProjectFont,
    VideoProjectKeyframe,
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
from video_project_animation import (
    duck_expression,
    is_animated,
    keyframe_expression,
    speech_spans,
)

#: Short side of the fixed-size presets; their long side is 16:9 of it.
SIZE_PRESET_SHORT_SIDES = {"720p": 720, "1080p": 1080}
WIDESCREEN = 16 / 9

AUDIO_SAMPLE_RATE = 48000
#: The limiter runs at four times the rate, so it also sees the peaks between samples.
LIMITER_OVERSAMPLING = 4

GRAPH_FILE_NAME = "graph.txt"
#: Animated sound is re-evaluated this many samples apart: about 5 ms at 48 kHz.
ENVELOPE_SAMPLES = 256
#: ``sendcmd`` intervals need an end; no project runs this long.
COMMAND_INTERVAL_END = "86400"


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
    """Seconds each clip fades in or out over: a dissolve's incoming picture, and both sides of
    each sound overlap on an audio track, a dissolve's linked sound among them."""
    clips = {clip.id: clip for clip in project.clips}
    fade_in: dict[str, float] = {}
    fade_out: dict[str, float] = {}
    for transition in project.transitions:
        first = clips[transition.from_clip_id]
        second = clips[transition.to_clip_id]
        overlap = first.end - second.start
        fade_in[second.id] = max(fade_in.get(second.id, 0.0), overlap)
    for track in project.tracks:
        if track.kind != "audio":
            continue
        ordered = sorted(
            (clip for clip in project.clips if clip.track_id == track.id),
            key=lambda clip: clip.start,
        )
        for first, second in pairwise(ordered):
            overlap = first.end - second.start
            if overlap > VIDEO_PROJECT_TIME_EPSILON:
                fade_out[first.id] = max(fade_out.get(first.id, 0.0), overlap)
                fade_in[second.id] = max(fade_in.get(second.id, 0.0), overlap)
    return fade_in, fade_out


def constant_value(keys: list[VideoProjectKeyframe], fallback: float) -> float:
    """A property that does not change over the clip: its one keyed value, or the static one."""
    return keys[0].value if keys else fallback


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


def fit_factor(frame: tuple[int, int], canvas: tuple[int, int], clip: VideoProjectClip) -> float:
    """Fit or fill the canvas. A title is drawn at the canvas size, so it is 1 for a title."""
    pick = min if clip.fit == "fit" else max
    return pick(canvas[0] / frame[0], canvas[1] / frame[1])


def placed_size(
    frame: tuple[int, int], canvas: tuple[int, int], clip: VideoProjectClip, scale: float
) -> tuple[int, int]:
    """Fit or fill, then ``scale``, the clip's own. The preview uses the same rule."""
    factor = fit_factor(frame, canvas, clip) * scale
    return max(2, round(frame[0] * factor)), max(2, round(frame[1] * factor))


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
    #: Seconds of output, for progress.
    duration: float


@dataclass(frozen=True, slots=True)
class RenderWindow:
    """What a render composes and which part of it it keeps: ``project`` is drawn for
    ``head + length`` seconds and the output starts ``head`` seconds in, a whole frame count."""

    project: VideoProject
    head: float
    length: float

    @property
    def composed(self) -> float:
        return self.head + self.length


def render_window(project: VideoProject, span: VideoProjectExportSpan | None) -> RenderWindow:
    """The whole project, or the clips around ``span`` moved back by whole frames, so the frame
    grid, fades, keyframes and offsets inside the span stay exactly as the full export has them.
    Clips just outside it are kept as well, for ducking that ramps in before speech."""
    duration = _checked_duration(project)
    if span is None:
        return RenderWindow(project, 0.0, duration)
    rate = project.frame_rate
    start = frame_index(span.start, rate) / rate
    end = min(span.end, duration)
    if end - start < VIDEO_PROJECT_MIN_CLIP_SECONDS:
        raise ValueError("The range to export lies past the end of the timeline")
    margin = VIDEO_PROJECT_DUCK_RAMP_SECONDS + 1 / rate
    near = [
        clip for clip in project.clips if clip.end > start - margin and clip.start < end + margin
    ]
    earliest = min((clip.start for clip in near), default=start)
    shift = min(frame_index(earliest, rate), round(start * rate))
    kept = {clip.id for clip in near}
    head = start - shift / rate
    part = project.model_copy(
        update={
            "clips": [clip.model_copy(update={"start": clip.start - shift / rate}) for clip in near]
            or [_spacer(project, head + end - start)],
            "transitions": [
                transition
                for transition in project.transitions
                if transition.from_clip_id in kept and transition.to_clip_id in kept
            ],
        }
    )
    return RenderWindow(part, head, end - start)


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
    transform = clip.transform
    keys = clip.keyframes
    shown = cropped_size(frame, clip)
    if is_animated(keys.scale):
        factor = f"{fit_factor(shown, canvas, clip):.9f}*({keyframe_expression(keys.scale, 't')})"
        box = placed_size(shown, canvas, clip, max(key.value for key in keys.scale))
        tail += [
            "format=rgba",
            f"scale=w='max(2,round(iw*{factor}))':h='max(2,round(ih*{factor}))'"
            ":eval=frame:flags=lanczos",
            f"pad=w={box[0]}:h={box[1]}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame",
            "format=rgba",
        ]
    else:
        width, height = placed_size(
            shown, canvas, clip, constant_value(keys.scale, transform.scale)
        )
        tail += [f"scale={width}:{height}:flags=lanczos", "format=rgba"]

    if is_animated(keys.rotation):
        # Clear corners: with c=none the turning layer would leave its last frames behind.
        angle = f"({keyframe_expression(keys.rotation, 't')})*PI/180"
        tail.append(f"rotate=a='{angle}':ow='hypot(iw,ih)':oh=ow:c=black@0")
    else:
        rotation = constant_value(keys.rotation, transform.rotation)
        if abs(rotation) > IDENTITY_EPSILON:
            radians = f"{math.radians(rotation):.8f}"
            tail.append(f"rotate=a={radians}:ow=rotw({radians}):oh=roth({radians}):c=none")
    if is_animated(keys.opacity):
        # sendcmd sits right before the mixer, so each command lands on the frame it was read for.
        commands = f"opacity{index}.cmd"
        expression = keyframe_expression(keys.opacity, "T")
        (workspace / commands).write_text(
            f"0-{COMMAND_INTERVAL_END} [expr] colorchannelmixer@opacity{index} aa '{expression}';\n",
            encoding="utf-8",
        )
        tail += [f"sendcmd=f={commands}", f"colorchannelmixer@opacity{index}=aa=1"]
    else:
        opacity = constant_value(keys.opacity, transform.opacity)
        if opacity < 1.0 - IDENTITY_EPSILON:
            tail.append(f"colorchannelmixer=aa={opacity:.6f}")
    fade_in, fade_out = fades
    if fade_in > IDENTITY_EPSILON:
        tail.append(f"fade=t=in:st=0:d={_seconds(fade_in)}:alpha=1")
    if fade_out > IDENTITY_EPSILON:
        start = max(0.0, clip.duration - fade_out)
        tail.append(f"fade=t=out:st={_seconds(start)}:d={_seconds(fade_out)}:alpha=1")
    # The layer runs on the project's frame grid here, so the offset is a whole number of
    # ticks; rounded, because setpts truncates and 26/24 s written to six places is 25.99999.
    tail.append(f"setpts=PTS+round({_seconds(clip.start)}/TB)")

    links.append(f"[{input_label}]{','.join(head + tail)}[layer{index}]")
    return links


def _overlay_position(clip: VideoProjectClip) -> tuple[str, str]:
    """Centred plus the offset; a keyed offset is read on the overlay's clock, the timeline's."""

    def offset(keys: list[VideoProjectKeyframe], static: float, size: str) -> str:
        if is_animated(keys):
            return f"{size}*({keyframe_expression(keys, f'(t-{_seconds(clip.start)})')})"
        return f"{size}*{constant_value(keys, static):.6f}"

    keys = clip.keyframes
    return (
        f"(W-w)/2+{offset(keys.x, clip.transform.x, 'W')}",
        f"(H-h)/2+{offset(keys.y, clip.transform.y, 'H')}",
    )


#: ``qsin`` is a quarter sine; faded out it is a quarter cosine, so the two sides keep power.
FADE_CURVES = {"linear": "tri", "equal_power": "qsin"}


def is_silent(clip: VideoProjectClip) -> bool:
    keys = clip.keyframes.gain
    if keys:
        return all(key.value <= IDENTITY_EPSILON for key in keys)
    return clip.gain <= IDENTITY_EPSILON


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
    envelope = clip.keyframes.gain
    if is_animated(envelope):
        filters += [
            f"asetnsamples=n={ENVELOPE_SAMPLES}:p=0",
            f"volume=volume='{keyframe_expression(envelope, 't')}':eval=frame",
        ]
    else:
        gain = constant_value(envelope, clip.gain)
        if abs(gain - 1.0) > IDENTITY_EPSILON:
            filters.append(f"volume={gain:.6f}")
    fade_in, fade_out = fades
    curve = FADE_CURVES[clip.fade_curve]
    if fade_in > IDENTITY_EPSILON:
        filters.append(f"afade=t=in:st=0:d={_seconds(fade_in)}:curve={curve}")
    if fade_out > IDENTITY_EPSILON:
        start = max(0.0, clip.duration - fade_out)
        filters.append(f"afade=t=out:st={_seconds(start)}:d={_seconds(fade_out)}:curve={curve}")
    delay = round(clip.start * 1000)
    if delay > 0:
        filters.append(f"adelay=delays={delay}:all=1")
    return f"[{input_label}]{','.join(filters)}[aud{index}]"


def _source_size(source: VideoProjectSource, project: VideoProject) -> tuple[int, int]:
    if source.width and source.height:
        return source.width, source.height
    return project.width, project.height


def _picture_links(
    project: VideoProject,
    folder: Path,
    inputs: RenderInputs,
    *,
    duration: float,
    workspace: Path,
    probe_color: ColorProbe,
) -> tuple[list[str], str]:
    """The composited canvas at the project's size, and the label it ends on."""
    sources = {source.id: source for source in project.sources}
    overlaps = transition_overlaps(project)
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
            x, y = _overlay_position(clip)
            links.append(
                f"[{base}][layer{layer}]overlay=x='{x}':y='{y}':eof_action=pass[stack{layer}]"
            )
            base = f"stack{layer}"
            layer += 1
    return links, base


def _mix_links(
    project: VideoProject, folder: Path, inputs: RenderInputs, *, duration: float
) -> tuple[list[str], str]:
    """Every audible clip summed per track, the tracks summed over silence of the full length.
    Sums are plain, so a gain of 1 everywhere leaves each clip as it is."""
    sources = {source.id: source for source in project.sources}
    overlaps = transition_overlaps(project)
    links = [
        f"anullsrc=r={AUDIO_SAMPLE_RATE}:cl=stereo,atrim=duration={_seconds(duration)}[silence]"
    ]
    audible = audible_tracks(project)
    spans = speech_spans(project, {track.id for track in audible})
    ducking = bool(spans) and project.mix.duck_gain < 1.0 - IDENTITY_EPSILON
    mixed = ["silence"]
    count = 0
    for track in audible:
        if track.gain <= IDENTITY_EPSILON:
            continue
        voices: list[str] = []
        for clip in sorted(
            (clip for clip in project.clips if clip.track_id == track.id),
            key=lambda clip: clip.start,
        ):
            if clip.kind != "audio" or is_silent(clip):
                continue
            source = sources[clip.source_id or ""]
            index = _audio_input(inputs, folder / source.name, clip)
            links.append(_audio_chain(clip, count, f"{index}:a", effective_fades(clip, overlaps)))
            voices.append(f"aud{count}")
            count += 1
        if not voices:
            continue
        stages = [
            f"amix=inputs={len(voices)}:duration=longest:dropout_transition=0:normalize=0"
            if len(voices) > 1
            else "anull"
        ]
        if abs(track.gain - 1.0) > IDENTITY_EPSILON:
            stages.append(f"volume={track.gain:.6f}")
        if ducking and not track.speech:
            # The track's sum starts at 00:00, so its clock is the timeline's.
            stages += [
                f"asetnsamples=n={ENVELOPE_SAMPLES}:p=0",
                f"volume=volume='{duck_expression(spans, project.mix.duck_gain)}':eval=frame",
            ]
        label = f"track{len(mixed)}"
        links.append(f"{''.join(f'[{voice}]' for voice in voices)}{','.join(stages)}[{label}]")
        mixed.append(label)
    master = project.mix.master_gain
    finish = [f"atrim=duration={_seconds(duration)}"]
    if abs(master - 1.0) > IDENTITY_EPSILON:
        finish.insert(0, f"volume={master:.6f}")
    if len(mixed) == 1:
        links.append(f"[silence]{','.join(finish)}[mix]")
    else:
        streams = "".join(f"[{name}]" for name in mixed)
        links.append(
            f"{streams}amix=inputs={len(mixed)}:duration=first:dropout_transition=0:normalize=0,"
            f"{','.join(finish)}[mix]"
        )
    return links, "mix"


def audio_level_filters(level: VideoProjectAudioLevel, measured_lufs: float | None) -> list[str]:
    """Normalization is one linear gain to the target, so the mix keeps its own dynamics. The
    limiter runs oversampled, so true peaks, not just samples, stay under the ceiling."""
    if level == "unchanged":
        return []
    filters: list[str] = []
    if level == "normalize" and measured_lufs is not None and math.isfinite(measured_lufs):
        filters.append(f"volume={VIDEO_PROJECT_LOUDNESS_TARGET_LUFS - measured_lufs:.3f}dB")
    ceiling = 10 ** (VIDEO_PROJECT_TRUE_PEAK_CEILING_DB / 20)
    filters += [
        f"aresample={AUDIO_SAMPLE_RATE * LIMITER_OVERSAMPLING}",
        f"alimiter=limit={ceiling:.6f}:level=disabled:latency=1",
        f"aresample={AUDIO_SAMPLE_RATE}",
    ]
    return filters


def _checked_duration(project: VideoProject) -> float:
    duration = project_duration(project)
    if duration <= 0:
        raise ValueError("The timeline is empty, so there is nothing to export")
    return duration


def build_render(
    project: VideoProject,
    folder: Path,
    output: Path,
    *,
    settings: VideoProjectExportSettings,
    executable: str,
    workspace: Path,
    probe_color: ColorProbe,
    measured_lufs: float | None = None,
    span: VideoProjectExportSpan | None = None,
) -> RenderPlan:
    """Write the graph and every layer file into ``workspace``, where ffmpeg must run.
    ``normalize`` needs ``measured_lufs``, the mix's loudness from ``build_mix_measure`` over the
    same ``span``."""
    window = render_window(project, span)
    part, duration = window.project, window.length
    inputs = RenderInputs(arguments=[])
    links, base = _picture_links(
        part, folder, inputs, duration=window.composed, workspace=workspace, probe_color=probe_color
    )

    width, height = export_size(project, settings)
    finish = ["setsar=1"]
    if (width, height) != (project.width, project.height):
        finish = [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black",
            "setsar=1",
        ]
    if window.head > 0:
        start_frame = round(window.head * project.frame_rate)
        finish = [f"trim=start_frame={start_frame}", "setpts=PTS-STARTPTS", *finish]
    links.append(f"[{base}]{','.join(finish)},format=yuv420p[vout]")

    mix_links, mix = _mix_links(part, folder, inputs, duration=window.composed)
    links += mix_links
    level = audio_level_filters(settings.audio_level, measured_lufs)
    stages = [*_span_audio(window), *level, f"atrim=duration={_seconds(duration)}"]
    links.append(f"[{mix}]{','.join(stages)}[aout]")

    (workspace / GRAPH_FILE_NAME).write_text(";\n".join(links), encoding="utf-8")

    quality = VIDEO_PROJECT_QUALITY_PRESETS[settings.quality]
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
        quality["preset"],
        "-crf",
        str(quality["crf"]),
        "-pix_fmt",
        "yuv420p",
        "-r",
        f"{project.frame_rate:.6f}",
        "-c:a",
        "aac",
        "-b:a",
        f"{quality['audio_kbps']}k",
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


def _span_audio(window: RenderWindow) -> list[str]:
    if window.head <= 0:
        return []
    return [f"atrim=start={_seconds(window.head)}", "asetpts=PTS-STARTPTS"]


def build_mix_measure(
    project: VideoProject,
    folder: Path,
    *,
    executable: str,
    workspace: Path,
    span: VideoProjectExportSpan | None = None,
) -> list[str]:
    """A sound-only pass that logs the unprocessed mix's loudness; see ``parse_loudness``."""
    window = render_window(project, span)
    inputs = RenderInputs(arguments=[])
    links, mix = _mix_links(window.project, folder, inputs, duration=window.composed)
    stages = [*_span_audio(window), "ebur128=peak=true:framelog=quiet"]
    links.append(f"[{mix}]{','.join(stages)}[aout]")
    (workspace / GRAPH_FILE_NAME).write_text(";\n".join(links), encoding="utf-8")
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info", "-y"),
        *inputs.arguments,
        *("-/filter_complex", GRAPH_FILE_NAME, "-map", "[aout]", "-f", "null", "-"),
    ]


def build_file_measure(executable: str, media: Path) -> list[str]:
    """Logs a finished file's loudness; see ``parse_loudness``."""
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info"),
        *("-i", str(media), "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet"),
        *("-f", "null", "-"),
    ]


_INTEGRATED = re.compile(r"Integrated loudness:\s*I:\s*(-?[\d.]+|-inf) LUFS")
_TRUE_PEAK = re.compile(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf) dBFS")


@dataclass(frozen=True, slots=True)
class Loudness:
    #: -inf for silence, which the measurement's gate leaves out entirely.
    integrated_lufs: float
    true_peak_db: float


def parse_loudness(log: str) -> Loudness | None:
    """The last ``ebur128`` summary in an ffmpeg log, or None when there is none."""
    integrated = _INTEGRATED.findall(log)
    peak = _TRUE_PEAK.findall(log)
    if not integrated or not peak:
        return None
    return Loudness(float(integrated[-1]), float(peak[-1]))


def frame_index(time: float, frame_rate: float) -> int:
    """The frame showing at ``time``: frame ``k`` runs from ``k / rate`` up to the next one."""
    return max(0, math.floor(time * frame_rate + 1e-6))


def build_frame(
    project: VideoProject,
    folder: Path,
    output: Path,
    time: float,
    *,
    executable: str,
    workspace: Path,
    probe_color: ColorProbe,
) -> list[str]:
    """One PNG of the export's picture at ``time``, at the project's size.

    Only clips around that frame are rendered, moved back by whole frames, so the frame grid
    and each clip's own fades and offsets stay exactly as the export has them."""
    duration = _checked_duration(project)
    rate = project.frame_rate
    index = min(frame_index(time, rate), max(0, math.ceil(duration * rate - 1e-6) - 1))
    at = index / rate
    near = [
        clip
        for clip in project.clips
        if clip.kind != "audio" and clip.start <= at + 1 / rate and clip.end >= at - 1 / rate
    ]
    names = {source.id: source.name for source in project.sources}
    for clip in near:
        if clip.source_id is not None and not (folder / names[clip.source_id]).is_file():
            raise ValueError(f"{names[clip.source_id]} is missing, so this frame cannot be drawn")
    shift = frame_index(min((clip.start for clip in near), default=at), rate)
    kept = {clip.id for clip in near}
    part = project.model_copy(
        update={
            "clips": [clip.model_copy(update={"start": clip.start - shift / rate}) for clip in near]
            or [_spacer(project, (index - shift + 1) / rate)],
            "transitions": [
                transition
                for transition in project.transitions
                if transition.from_clip_id in kept and transition.to_clip_id in kept
            ],
        }
    )
    length = max(project_duration(part), (index - shift + 1) / rate)
    inputs = RenderInputs(arguments=[])
    links, base = _picture_links(
        part, folder, inputs, duration=length, workspace=workspace, probe_color=probe_color
    )
    links.append(f"[{base}]select='eq(n\\,{index - shift})',setsar=1,format=rgb24[vout]")
    (workspace / GRAPH_FILE_NAME).write_text(";\n".join(links), encoding="utf-8")
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "error", "-y"),
        *inputs.arguments,
        *("-/filter_complex", GRAPH_FILE_NAME, "-map", "[vout]", "-frames:v", "1"),
        *("-update", "1", "-f", "image2", "-c:v", "png", str(output)),
    ]


def _spacer(project: VideoProject, duration: float) -> VideoProjectClip:
    """An empty title, so a frame in a gap still has a canvas to draw."""
    track = next(track.id for track in project.tracks if track.kind == "video")
    return VideoProjectClip(
        id="frame-spacer",
        track_id=track,
        kind="title",
        start=0.0,
        duration=max(duration, VIDEO_PROJECT_MIN_CLIP_SECONDS),
        title=VideoProjectTitle(text=""),
    )


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
