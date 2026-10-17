"""Keyframes and ducking, as values and as ffmpeg expressions of time.

The preview evaluates the same rules in ``lib/keyframes.ts``; an expression written here must give
what ``keyframe_value`` gives at every frame time, or the export would not move as the preview.
"""

from __future__ import annotations

from collections.abc import Sequence
from itertools import pairwise

from constants import VIDEO_PROJECT_DUCK_RAMP_SECONDS
from schemas import (
    VideoProject,
    VideoProjectClip,
    VideoProjectEasing,
    VideoProjectKeyframe,
)


def ease(easing: VideoProjectEasing, progress: float) -> float:
    """How far along the way to the next value, for ``progress`` from 0 to 1."""
    u = min(1.0, max(0.0, progress))
    if easing == "ease_in":
        return u * u
    if easing == "ease_out":
        return u * (2 - u)
    if easing == "ease_in_out":
        return u * u * (3 - 2 * u)
    if easing == "hold":
        return 0.0
    return u


def keyframe_value(keys: Sequence[VideoProjectKeyframe], time: float, fallback: float) -> float:
    """The value at ``time`` from the clip's start; ``fallback`` when nothing is keyed."""
    if not keys:
        return fallback
    if time <= keys[0].time:
        return keys[0].value
    for before, after in pairwise(keys):
        if time < after.time:
            progress = (time - before.time) / (after.time - before.time)
            return before.value + (after.value - before.value) * ease(before.easing, progress)
    return keys[-1].value


def _number(value: float) -> str:
    return f"{value:.6f}"


def _eased(easing: VideoProjectEasing, progress: str) -> str:
    u = f"clip({progress},0,1)"
    if easing == "ease_in":
        return f"{u}*{u}"
    if easing == "ease_out":
        return f"{u}*(2-{u})"
    if easing == "ease_in_out":
        return f"{u}*{u}*(3-2*{u})"
    return u


def keyframe_expression(keys: Sequence[VideoProjectKeyframe], time: str) -> str:
    """``keyframe_value`` for ffmpeg's evaluator, ``time`` naming the clip's own clock. It holds
    commas, so the graph must quote it."""
    assert keys, "a constant needs no expression"
    expression = _number(keys[-1].value)
    for before, after in reversed(list(pairwise(keys))):
        if before.easing == "hold" or abs(after.value - before.value) < 1e-12:
            segment = _number(before.value)
        else:
            span = after.time - before.time
            progress = f"({time}-{_number(before.time)})/{_number(span)}"
            change = _number(after.value - before.value)
            segment = f"{_number(before.value)}+{change}*({_eased(before.easing, progress)})"
        expression = f"if(lt({time},{_number(after.time)}),{segment},{expression})"
    return expression


def is_animated(keys: Sequence[VideoProjectKeyframe]) -> bool:
    """One keyframe is a constant; two of the same value are too."""
    return len({key.value for key in keys}) > 1


def speech_spans(project: VideoProject, audible: set[str]) -> list[tuple[float, float]]:
    """Where speech sounds: the clips on audible speech tracks, in timeline seconds."""
    speech = {track.id for track in project.tracks if track.speech and track.id in audible}
    return sorted(
        (clip.start, clip.end)
        for clip in project.clips
        if clip.kind == "audio" and clip.track_id in speech and _sounds(clip)
    )


def _sounds(clip: VideoProjectClip) -> bool:
    if clip.keyframes.gain:
        return any(key.value > 0 for key in clip.keyframes.gain)
    return clip.gain > 0


def duck_presence(spans: Sequence[tuple[float, float]], time: float) -> float:
    """0 away from speech, 1 while it sounds, ramping over the ramp before and after each span.
    Ramps of spans close together add up, so a short pause between lines stays ducked."""
    ramp = VIDEO_PROJECT_DUCK_RAMP_SECONDS
    total = 0.0
    for start, end in spans:
        rise = min(1.0, max(0.0, (time - start + ramp) / ramp))
        fall = min(1.0, max(0.0, (end + ramp - time) / ramp))
        total += min(rise, fall)
    return min(1.0, total)


def duck_level(spans: Sequence[tuple[float, float]], duck_gain: float, time: float) -> float:
    return 1 - (1 - duck_gain) * duck_presence(spans, time)


def duck_expression(spans: Sequence[tuple[float, float]], duck_gain: float) -> str:
    """``duck_level`` of timeline time ``t``."""
    ramp = _number(VIDEO_PROJECT_DUCK_RAMP_SECONDS)
    terms = [
        f"min(clip((t-{_number(start)}+{ramp})/{ramp},0,1),"
        f"clip(({_number(end)}+{ramp}-t)/{ramp},0,1))"
        for start, end in spans
    ]
    return f"1-{_number(1 - duck_gain)}*min(1,{'+'.join(terms)})"
