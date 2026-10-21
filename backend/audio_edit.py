"""Trim, fade, level, retime, repitch and shape one audio file in place from its untouched original.

Noise reduction and pitch come from the proxy the preview plays (``audio_effects.audio_proxy``),
so the file ends up sounding the way it was heard. Everything after runs in one pass: trim,
speed, EQ, volume, fades in output time, then the level stage. The file keeps its own format."""

from __future__ import annotations

import json
import logging
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from audio_effects import (
    AudioProbe,
    audio_proxy,
    check_audio_filters,
    eq_filters,
    is_effects_identity,
    needs_proxy,
    probe_audio,
)
from audio_info import audio_duration
from audio_level import MEASURE_FILTER, audio_level_filters, parse_loudness
from constants import AUDIO_EDIT_MUXERS
from edit_sidecars import (
    edit_spec_path,
    ensure_backup,
    publish_with_spec,
    read_spec,
    restore_backup,
    sweep_edit_temp_files,
    temp_path_for,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import ProgressCallback, ShouldCancel, run_ffmpeg
from schemas import AudioEditResponse, AudioEditSpec
from video_edit import IDENTITY_EPSILON, atempo_chain
from video_project_render import FADE_CURVES

logger = logging.getLogger(__name__)

FFMPEG_MISSING_MESSAGE = "ffmpeg is required to edit audio"
AUDIO_EDIT_TIMEOUT_SECONDS = 1800

#: What LAME can write at a constant rate; a source's average is snapped to the nearest.
MP3_BITRATES = (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
#: Used when the source reports no bitrate: LAME's high-quality variable rate.
MP3_FALLBACK_QUALITY = "2"


def read_audio_edit_spec(media: Path) -> AudioEditSpec | None:
    """``None`` for a spec with fields an audio edit lacks: a same-stem video's or image's, which
    is expected beside it rather than unreadable."""
    try:
        raw = json.loads(edit_spec_path(media).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(raw, dict) or not raw.keys() <= AudioEditSpec.model_fields.keys():
        return None
    return read_spec(media, AudioEditSpec)


def is_identity_spec(spec: AudioEditSpec) -> bool:
    return (
        spec.trim_start < IDENTITY_EPSILON
        and spec.trim_end is None
        and spec.fade_in < IDENTITY_EPSILON
        and spec.fade_out < IDENTITY_EPSILON
        and abs(spec.volume - 1.0) < IDENTITY_EPSILON
        and spec.level == "unchanged"
        and abs(spec.speed - 1.0) < IDENTITY_EPSILON
        and spec.pitch == 0
        and is_effects_identity(spec.effects)
    )


def resolve_muxer(media: Path) -> str:
    muxer = AUDIO_EDIT_MUXERS.get(media.suffix.lower())
    if muxer is None:
        raise ValueError(f"{media.suffix} audio cannot be edited")
    return muxer


def expected_output_seconds(spec: AudioEditSpec, source_seconds: float | None) -> float | None:
    end = spec.trim_end if spec.trim_end is not None else source_seconds
    if end is None:
        return None
    return max(0.0, end - spec.trim_start) / spec.speed


def _seconds(value: float) -> str:
    return f"{value:.6f}"


def build_audio_filters(
    spec: AudioEditSpec, output_seconds: float | None, *, level: list[str] | None = None
) -> list[str]:
    """Trim in source time, then speed, EQ, volume and fades in output time. ``level`` is the
    level stage, or ``None`` to stop before it, as the loudness measurement does."""
    filters: list[str] = []
    if spec.trim_start > 0 or spec.trim_end is not None:
        bounds = [f"start={_seconds(spec.trim_start)}"]
        if spec.trim_end is not None:
            bounds.append(f"end={_seconds(spec.trim_end)}")
        filters += [f"atrim={':'.join(bounds)}", "asetpts=PTS-STARTPTS"]
    if abs(spec.speed - 1.0) > IDENTITY_EPSILON:
        filters.append(atempo_chain(spec.speed))
    filters += eq_filters(spec.effects)
    if abs(spec.volume - 1.0) > IDENTITY_EPSILON:
        filters.append(f"volume={spec.volume:.6f}")
    curve = FADE_CURVES[spec.fade_curve]
    if spec.fade_in > IDENTITY_EPSILON:
        filters.append(f"afade=t=in:st=0:d={_seconds(spec.fade_in)}:curve={curve}")
    if spec.fade_out > IDENTITY_EPSILON:
        if output_seconds is None:
            raise ValueError("The sound's length could not be read, so it cannot fade out")
        start = max(0.0, output_seconds - spec.fade_out)
        filters.append(
            f"afade=t=out:st={_seconds(start)}:d={_seconds(spec.fade_out)}:curve={curve}"
        )
    return [*filters, *(level or [])]


def _nearest_mp3_bitrate(kbps: int) -> int:
    return min(MP3_BITRATES, key=lambda rate: abs(rate - kbps))


def encoder_arguments(muxer: str, probe: AudioProbe) -> list[str]:
    """The source's own encoding, as near as the encoder allows: a WAV keeps its sample format,
    a FLAC its depth, an MP3 its bitrate."""
    rate = ["-ar", str(probe.sample_rate)] if probe.sample_rate else []
    if muxer == "wav":
        codec = probe.codec if probe.codec and probe.codec.startswith("pcm_") else "pcm_s16le"
        return ["-c:a", codec, *rate]
    if muxer == "flac":
        sample_format = "s16" if probe.sample_format == "s16" else "s32"
        return ["-c:a", "flac", "-sample_fmt", sample_format, *rate]
    if probe.kbps:
        quality = ["-b:a", f"{_nearest_mp3_bitrate(probe.kbps)}k"]
    else:
        quality = ["-q:a", MP3_FALLBACK_QUALITY]
    return ["-c:a", "libmp3lame", *quality, *rate, "-id3v2_version", "3"]


def build_audio_edit_command(
    source: Path,
    destination: Path,
    filters: list[str],
    *,
    executable: str,
    muxer: str,
    probe: AudioProbe,
    tagged: Path,
) -> list[str]:
    """``tagged`` is the original, whose tags and cover go on even when ``source`` is a proxy."""
    command = [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "error"),
        *("-progress", "pipe:1", "-y", "-i", str(source)),
    ]
    tags = 0
    if tagged != source:
        command += ["-i", str(tagged)]
        tags = 1
    command += ["-map", "0:a:0", "-map_metadata", str(tags)]
    # A WAV keeps no cover; an MP3 or FLAC keeps its picture as it is.
    if muxer != "wav" and probe.has_picture:
        command += ["-map", f"{tags}:v?", "-c:v", "copy", "-disposition:v", "attached_pic"]
    if filters:
        command += ["-af", ",".join(filters)]
    command += encoder_arguments(muxer, probe)
    command += ["-f", muxer, str(destination)]
    return command


def build_measure_command(executable: str, source: Path, filters: list[str]) -> list[str]:
    """Logs the loudness of the sound as edited, before its level stage; see ``parse_loudness``."""
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info"),
        *("-i", str(source), "-map", "0:a:0", "-af", ",".join([*filters, MEASURE_FILTER])),
        *("-f", "null", "-"),
    ]


def _render_source(executable: str, original: Path, spec: AudioEditSpec) -> Path:
    if needs_proxy(spec.effects.noise_reduction, spec.pitch):
        return audio_proxy(
            executable, original, noise_reduction=spec.effects.noise_reduction, pitch=spec.pitch
        )
    return original


def measure_loudness(
    original: Path, spec: AudioEditSpec, *, ffmpeg: str | None = None
) -> float | None:
    """Integrated LUFS of ``original`` as ``spec`` shapes it, before the level stage; ``None``
    for silence. The preview's normalize gain, and the render's."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)
    source = _render_source(executable, original, spec)
    probe = probe_audio(executable, original)
    output_seconds = expected_output_seconds(spec, probe.duration)
    log = run_ffmpeg(
        build_measure_command(executable, source, build_audio_filters(spec, output_seconds)),
        timeout=AUDIO_EDIT_TIMEOUT_SECONDS,
    )
    loudness = parse_loudness(log)
    if loudness is None or loudness.integrated_lufs == float("-inf"):
        return None
    return loudness.integrated_lufs


def describe_edited(media: Path, *, has_backup: bool) -> AudioEditResponse:
    stat = media.stat()
    return AudioEditResponse(
        path=str(media),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        duration=audio_duration(media),
        has_backup=has_backup,
    )


def apply_audio_edit(
    media: Path,
    spec: AudioEditSpec,
    *,
    ffmpeg: str | None = None,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
) -> AudioEditResponse:
    """Render ``spec`` from the original. On failure the live file is left byte-identical."""
    executable = ffmpeg or ffmpeg_path()
    if not executable:
        raise RuntimeError(FFMPEG_MISSING_MESSAGE)

    muxer = resolve_muxer(media)
    sweep_edit_temp_files(media.parent)
    check_audio_filters(executable, spec.effects, pitch=spec.pitch)

    original = ensure_backup(media)
    probe = probe_audio(executable, original)
    if probe.sample_rate is None:
        raise ValueError(f"{media.name} has no sound that ffmpeg can read")
    output_seconds = expected_output_seconds(spec, probe.duration)
    if (
        output_seconds is not None
        and spec.fade_in + spec.fade_out > output_seconds + IDENTITY_EPSILON
    ):
        raise ValueError("The fades cannot be longer than the sound they shape")

    source = _render_source(executable, original, spec)
    measured = None
    if spec.level == "normalize":
        measured = measure_loudness(original, spec, ffmpeg=executable)
    filters = build_audio_filters(
        spec,
        output_seconds,
        level=audio_level_filters(spec.level, measured, probe.sample_rate),
    )
    temp_path = temp_path_for(media)
    command = build_audio_edit_command(
        source,
        temp_path,
        filters,
        executable=executable,
        muxer=muxer,
        probe=probe,
        tagged=original,
    )

    try:
        run_ffmpeg(
            command,
            should_cancel=should_cancel,
            on_progress=on_progress,
            timeout=AUDIO_EDIT_TIMEOUT_SECONDS,
        )
        publish_with_spec(temp_path, media, spec)
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    return describe_edited(media, has_backup=True)


def revert_audio_edit(media: Path) -> AudioEditResponse:
    restore_backup(media)
    return describe_edited(media, has_backup=False)
