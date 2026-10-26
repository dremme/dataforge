"""Sound shaping shared by the gallery's audio edit and the editor's audio clips.

The bands are RBJ-cookbook biquads at frequencies, Q and slopes the browser's
``BiquadFilterNode`` uses too (``frontend/src/shared/lib/audioEffects.ts``), so the live preview
plays the curves the render writes. Noise reduction and pitch have no browser equivalent: they are
rendered into a proxy file that the preview plays and the render reads, so they have one renderer.
"""

from __future__ import annotations

import re
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from constants import (
    AUDIO_EQ_BASS_HZ,
    AUDIO_EQ_MID_HZ,
    AUDIO_EQ_MID_Q,
    AUDIO_EQ_TREBLE_HZ,
    AUDIO_NOISE_REDUCTION_MAX_DB,
)
from ffmpeg_run import run_ffmpeg
from schemas import AudioEffects
from thumbnails import AUDIO_PROXY_SUFFIX
from video_edit import IDENTITY_EPSILON, atempo_chain, ffmpeg_filters
from video_project_media import cache_path, cached_render

#: afftdn takes no less.
MIN_NOISE_REDUCTION_DB = 0.01
AUDIO_PROXY_TIMEOUT_SECONDS = 1800
#: Part of the cache key; bump it when a proxy is rendered differently.
AUDIO_PROXY_VERSION = 1
PROBE_TIMEOUT_SECONDS = 15
#: Where the delay probe's click sits, and how long the probe runs: well past any window.
DELAY_CLICK_SECONDS = 0.1
DELAY_PROBE_SECONDS = 0.4
#: The noise profile is learned from the quietest stretch this long, found at a coarse rate.
NOISE_SAMPLE_SECONDS = 0.5
NOISE_SAMPLE_MARGIN_SECONDS = 0.02
QUIET_SCAN_RATE = 8000
QUIET_BLOCK_SECONDS = 0.05
#: Mean power below about -100 dBFS: digital silence, not noise.
DIGITAL_SILENCE_POWER = 1e-10
#: afftdn's loudest floor. With a learned profile it reduces by ``nr`` dB at any noise level
#: under this; a lower floor lets louder noise through untouched.
NOISE_FLOOR_CEILING_DB = -20


def is_eq_identity(effects: AudioEffects) -> bool:
    return (
        not effects.low_cut
        and not effects.high_cut
        and abs(effects.bass) < IDENTITY_EPSILON
        and abs(effects.mid) < IDENTITY_EPSILON
        and abs(effects.treble) < IDENTITY_EPSILON
    )


def is_effects_identity(effects: AudioEffects) -> bool:
    return is_eq_identity(effects) and effects.noise_reduction < IDENTITY_EPSILON


#: The EQ's gain bands, which a video project clip can animate, and the filter each one runs.
EQ_BAND_FILTERS = {"bass": "lowshelf", "mid": "equalizer", "treble": "highshelf"}


def eq_filters(effects: AudioEffects, named: Mapping[str, str] | None = None) -> list[str]:
    """Low to high. ``p=2`` is a Butterworth pole pair (Q 0.707); the shelves use slope 1 and the
    peak a linear Q, which is how the browser's biquads read the same numbers. A gain band in
    ``named`` stays in at 0 dB too, under that instance name, so commands can move its gain."""
    named = named or {}
    filters: list[str] = []

    def band(name: str, gain: float, options: str) -> None:
        if name in named:
            filters.append(f"{EQ_BAND_FILTERS[name]}@{named[name]}={options}")
        elif abs(gain) >= IDENTITY_EPSILON:
            filters.append(f"{EQ_BAND_FILTERS[name]}={options}")

    if effects.low_cut:
        filters.append(f"highpass=f={effects.low_cut:.3f}:p=2")
    band("bass", effects.bass, f"g={effects.bass:.3f}:f={AUDIO_EQ_BASS_HZ:g}:t=s:w=1")
    band("mid", effects.mid, f"f={AUDIO_EQ_MID_HZ:g}:t=q:w={AUDIO_EQ_MID_Q:g}:g={effects.mid:.3f}")
    band("treble", effects.treble, f"g={effects.treble:.3f}:f={AUDIO_EQ_TREBLE_HZ:g}:t=s:w=1")
    if effects.high_cut:
        filters.append(f"lowpass=f={effects.high_cut:.3f}:p=2")
    return filters


@dataclass(frozen=True, slots=True)
class AudioProbe:
    """From ffmpeg's own stream summary; ``None`` wherever it reported nothing."""

    codec: str | None = None
    sample_rate: int | None = None
    #: ``s16``, ``s32``, ``fltp`` and so on: what the decoder hands on.
    sample_format: str | None = None
    #: The stored depth when it differs from the format's, as in ``s32 (24 bit)``.
    bits: int | None = None
    kbps: int | None = None
    duration: float | None = None
    has_picture: bool = False


_AUDIO_STREAM = re.compile(
    r"^\s*Stream #\S+: Audio: (?P<codec>\w+)[^,]*, (?P<rate>\d+) Hz, [^,]+, (?P<format>\w+)"
    r"(?: \((?P<bits>\d+) bit\))?(?:, (?P<kbps>\d+) kb/s)?",
    re.MULTILINE,
)
_DURATION = re.compile(r"Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)")
_PICTURE = re.compile(r"^\s*Stream #\S+: Video: ", re.MULTILINE)


def parse_audio_probe(summary: str) -> AudioProbe:
    stream = _AUDIO_STREAM.search(summary)
    duration = _DURATION.search(summary)
    seconds = None
    if duration:
        hours, minutes, rest = duration.groups()
        seconds = int(hours) * 3600 + int(minutes) * 60 + float(rest)
    if stream is None:
        return AudioProbe(duration=seconds)
    return AudioProbe(
        codec=stream["codec"],
        sample_rate=int(stream["rate"]),
        sample_format=stream["format"],
        bits=int(stream["bits"]) if stream["bits"] else None,
        kbps=int(stream["kbps"]) if stream["kbps"] else None,
        duration=seconds,
        has_picture=_PICTURE.search(summary) is not None,
    )


def probe_audio(executable: str, media: Path) -> AudioProbe:
    """Read, not decoded. ffmpeg rather than mutagen, which cannot tell float WAV from integer."""
    try:
        result = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-i", str(media)],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return AudioProbe()
    return parse_audio_probe(result.stderr.decode("utf-8", errors="replace"))


def _afftdn(reduction: float) -> str:
    """``tn`` follows the noise as it changes, so one strength suits a whole file."""
    return f"afftdn=nr={reduction:.3f}:tn=1"


@lru_cache(maxsize=32)
def denoise_delay(executable: str, sample_rate: int) -> int:
    """Samples afftdn holds the sound back by, measured on a click: about 25 ms, rounded to its
    window, which differs by rate. The length stays, so uncorrected the end would be cut off."""
    click = round(sample_rate * DELAY_CLICK_SECONDS)
    source = f"aevalsrc=if(eq(n\\,{click})\\,0.9\\,0):s={sample_rate}:d={DELAY_PROBE_SECONDS}"
    command = [
        *(executable, "-nostdin", "-hide_banner", "-loglevel", "error"),
        *("-f", "lavfi", "-i", f"{source},{_afftdn(MIN_NOISE_REDUCTION_DB)}"),
        *("-f", "f32le", "-ac", "1", "-"),
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, timeout=PROBE_TIMEOUT_SECONDS, check=True
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"Could not measure the noise reduction's delay: {exc}") from exc
    samples = np.frombuffer(result.stdout, dtype="<f4")
    if samples.size == 0 or not np.any(samples):
        raise RuntimeError("Could not measure the noise reduction's delay")
    return max(0, int(np.argmax(np.abs(samples))) - click)


def quiet_stretch(executable: str, source: Path, sample_rate: int) -> tuple[int, int]:
    """``(start, length)`` in samples of the quietest stretch that still holds sound: the noise
    with as little else as the file has. Digital silence teaches the noise profile nothing."""
    decoded = subprocess.run(
        [
            *(executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source)),
            *("-map", "0:a:0", "-ac", "1", "-ar", str(QUIET_SCAN_RATE), "-f", "f32le", "-"),
        ],
        capture_output=True,
        timeout=AUDIO_PROXY_TIMEOUT_SECONDS,
        check=True,
    ).stdout
    samples = np.frombuffer(decoded, dtype="<f4").astype(np.float64)
    block = round(QUIET_SCAN_RATE * QUIET_BLOCK_SECONDS)
    blocks = samples.size // block
    span = max(1, round(NOISE_SAMPLE_SECONDS / QUIET_BLOCK_SECONDS))
    if blocks <= span:
        return 0, round(samples.size / QUIET_SCAN_RATE * sample_rate)
    power = np.mean(samples[: blocks * block].reshape(blocks, block) ** 2, axis=1)
    windows = np.convolve(power, np.ones(span) / span, mode="valid")
    windows[windows < DIGITAL_SILENCE_POWER] = np.inf
    first = int(np.argmin(windows)) if np.isfinite(windows).any() else 0
    seconds_per_block = block / QUIET_SCAN_RATE
    return (
        round(first * seconds_per_block * sample_rate),
        round(span * seconds_per_block * sample_rate),
    )


def denoise_links(
    strength: float, delay: int, quiet: tuple[int, int], sample_rate: int, output: str
) -> list[str]:
    """afftdn learns the noise from the quiet stretch, played once ahead of the file, then reduces
    by ``strength`` of the maximum in dB. Its fixed floor (``nf``) would reduce only noise as
    white and as loud as the floor. The stretch and the filter's delay are trimmed back off, and
    the end padded by the delay, so the sound keeps its place to the sample and its whole length.
    """
    reduction = max(MIN_NOISE_REDUCTION_DB, strength * AUDIO_NOISE_REDUCTION_MAX_DB)
    start, length = quiet
    margin = min(NOISE_SAMPLE_MARGIN_SECONDS, length / sample_rate / 4)
    sampling = f"{margin:.6f} afftdn@dn sample_noise start"
    stop = f"{length / sample_rate - margin:.6f} afftdn@dn sample_noise stop"
    return [
        "[0:a:0]asplit[noise][body]",
        f"[noise]atrim=start_sample={start}:end_sample={start + length},asetpts=PTS-STARTPTS[lead]",
        f"[body]asetpts=PTS-STARTPTS,apad=pad_len={delay}[padded]",
        f"[lead][padded]concat=n=2:v=0:a=1,asendcmd=c='{sampling}\\;{stop}',"
        f"afftdn@dn=nr={reduction:.3f}:nf={NOISE_FLOOR_CEILING_DB:g},"
        f"atrim=start_sample={length + delay},asetpts=PTS-STARTPTS[{output}]",
    ]


def pitch_ratio(semitones: int, sample_rate: int) -> float:
    """What ``asetrate`` can actually do: it takes a whole rate, so the ratio is rounded to one."""
    return round(sample_rate * 2 ** (semitones / 12)) / sample_rate


def pitch_filters(semitones: int, sample_rate: int) -> list[str]:
    """Plays the samples faster or slower, which moves the pitch and the length together, then
    stretches the length back with ``atempo``, which keeps the pitch."""
    if semitones == 0:
        return []
    ratio = pitch_ratio(semitones, sample_rate)
    return [
        f"asetrate={round(sample_rate * ratio)}",
        f"aresample={sample_rate}",
        atempo_chain(1 / ratio),
    ]


def needs_proxy(noise_reduction: float, pitch: int = 0) -> bool:
    return noise_reduction >= IDENTITY_EPSILON or pitch != 0


def required_filters(effects: AudioEffects, *, pitch: int = 0) -> set[str]:
    needed = {name.partition("=")[0] for name in eq_filters(effects)}
    if effects.noise_reduction >= IDENTITY_EPSILON:
        needed.update({"afftdn", "asendcmd", "apad", "atrim", "concat", "aevalsrc"})
    if pitch:
        needed.update({"asetrate", "aresample", "atempo"})
    return needed


def check_audio_filters(executable: str, effects: AudioEffects, *, pitch: int = 0) -> None:
    missing = sorted(required_filters(effects, pitch=pitch) - ffmpeg_filters(executable))
    if missing:
        raise RuntimeError(f"This ffmpeg has no {', '.join(missing)} filter")


def proxy_links(
    noise_reduction: float,
    pitch: int,
    sample_rate: int,
    *,
    delay: int = 0,
    quiet: tuple[int, int] = (0, 0),
) -> list[str]:
    """The proxy's graph, from the first sound stream to ``[proxy]``."""
    links: list[str] = []
    head = "[0:a:0]"
    if noise_reduction >= IDENTITY_EPSILON:
        links += denoise_links(noise_reduction, delay, quiet, sample_rate, "denoised")
        head = "[denoised]"
    links.append(f"{head}{','.join(pitch_filters(pitch, sample_rate)) or 'anull'}[proxy]")
    return links


def audio_proxy_command(
    executable: str, source: Path, destination: Path, links: list[str]
) -> list[str]:
    """FLAC at 24 bits: lossless enough to stand in for the source, and the browser plays it."""
    return [
        *(executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y"),
        *("-i", str(source), "-filter_complex", ";".join(links), "-map", "[proxy]"),
        *("-c:a", "flac", "-sample_fmt", "s32", "-f", "flac", str(destination)),
    ]


def audio_proxy(executable: str, source: Path, *, noise_reduction: float, pitch: int = 0) -> Path:
    """The whole file with its noise reduced and pitch moved, cached beside the timeline pictures
    and keyed by the source's stat. Noise reduction keeps the source's timing to the sample; a
    pitch move shifts it by a few milliseconds, which only the gallery's own edit takes."""
    if not needs_proxy(noise_reduction, pitch):
        raise ValueError("This sound needs no proxy")
    destination = cache_path(
        source,
        "audio-proxy",
        f"{noise_reduction:.4f}",
        pitch,
        AUDIO_PROXY_VERSION,
        suffix=AUDIO_PROXY_SUFFIX,
    )

    def build(partial: Path) -> None:
        rate = probe_audio(executable, source).sample_rate
        if rate is None:
            raise ValueError(f"{source.name} has no sound that ffmpeg can read")
        denoised = noise_reduction >= IDENTITY_EPSILON
        links = proxy_links(
            noise_reduction,
            pitch,
            rate,
            delay=denoise_delay(executable, rate) if denoised else 0,
            quiet=quiet_stretch(executable, source, rate) if denoised else (0, 0),
        )
        run_ffmpeg(
            audio_proxy_command(executable, source, partial, links),
            timeout=AUDIO_PROXY_TIMEOUT_SECONDS,
        )

    return cached_render(destination, build)
