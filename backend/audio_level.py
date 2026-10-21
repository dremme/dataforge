"""Loudness: measuring it with ``ebur128``, and the level stage that limits or normalizes it.

Shared by the editor's export and the gallery's audio edit, so both mean the same by a level."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path

from constants import VIDEO_PROJECT_LOUDNESS_TARGET_LUFS, VIDEO_PROJECT_TRUE_PEAK_CEILING_DB
from schemas import AudioLevel

#: The limiter runs at four times the rate, so it also sees the peaks between samples.
LIMITER_OVERSAMPLING = 4

MEASURE_FILTER = "ebur128=peak=true:framelog=quiet"


def audio_level_filters(
    level: AudioLevel, measured_lufs: float | None, sample_rate: int
) -> list[str]:
    """Normalization is one linear gain to the target, so the sound keeps its own dynamics. The
    limiter runs oversampled, so true peaks, not just samples, stay under the ceiling."""
    if level == "unchanged":
        return []
    filters: list[str] = []
    if level == "normalize" and measured_lufs is not None and math.isfinite(measured_lufs):
        filters.append(f"volume={VIDEO_PROJECT_LOUDNESS_TARGET_LUFS - measured_lufs:.3f}dB")
    ceiling = 10 ** (VIDEO_PROJECT_TRUE_PEAK_CEILING_DB / 20)
    filters += [
        f"aresample={sample_rate * LIMITER_OVERSAMPLING}",
        f"alimiter=limit={ceiling:.6f}:level=disabled:latency=1",
        f"aresample={sample_rate}",
    ]
    return filters


def build_file_measure(executable: str, media: Path) -> list[str]:
    """Logs a finished file's loudness; see ``parse_loudness``."""
    return [
        *(executable, "-nostdin", "-hide_banner", "-nostats", "-loglevel", "info"),
        *("-i", str(media), "-map", "0:a:0", "-af", MEASURE_FILTER),
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
