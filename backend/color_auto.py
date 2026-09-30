"""The Adjust wand: read an image or a clip and suggest tool positions that tidy its levels and cast.

Suggestions are deliberately partial, so running the wand on its own result changes little.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from PIL import Image

from color_adjust import LUMA, linear_to_srgb, srgb_to_linear, tone_curve, white_balance_gains
from constants import COLOR_ADJUST
from image_io import load_image_for_edit
from schemas import ColorAdjust, EditCropRect, MaskRegion

logger = logging.getLogger(__name__)

#: Long side the analysis reads at; statistics settle long before full resolution.
ANALYSIS_SIDE = 512
VIDEO_ANALYSIS_SIDE = 256
VIDEO_SAMPLE_FRAMES = 8

#: Where a well-exposed median lands, in encoded luminance: a shade under middle grey.
TARGET_MEDIAN = 0.45
#: Share of each measured correction the wand applies.
CORRECTION_SHARE = 0.5
MAX_SUGGESTION = 0.5
#: Dark and bright scenes are often meant that way, so exposure moves less than the rest.
MAX_EXPOSURE = 0.3
MAX_WHITE_BALANCE = 0.25
MAX_CONTRAST = 0.3
MAX_VIBRANCE = 0.3
#: A warm scene reads like a warm cast, and cooling a sunset is the worse mistake.
COOLING_SHARE = 0.25
MAX_COOLING = 0.1
#: Below this a suggestion is noise, and a tool the user did not ask about should stay at 0.
DEAD_ZONE = 0.03

HAZE_FLOOR = 0.08
BLACK_TARGET = 0.01
CLIPPED_LEVEL = 0.97
CLIPPED_ALLOWANCE = 0.01
DEEP_SHADOW_LEVEL = 0.1
DEEP_SHADOW_ALLOWANCE = 0.15
FLAT_SPREAD = 0.6
DULL_SATURATION = 0.3
NEUTRAL_SATURATION = 0.15
#: Grey-world needs this share of near-grey pixels, or a warm sunset reads as an orange cast.
MIN_NEUTRAL_SHARE = 0.1
WHITE_BALANCE_ROUNDS = 3


class NothingToAnalyseError(ValueError):
    """Raised when the crop, masks and transparency leave no pixel to read."""


def _clamp(value: float, limit: float = MAX_SUGGESTION) -> float:
    rounded = round(max(-limit, min(limit, value)), 2)
    return 0.0 if abs(rounded) < DEAD_ZONE else rounded


def _cooled_or_warmed(warmth: float) -> float:
    if warmth < 0:
        return _clamp(COOLING_SHARE * warmth, MAX_COOLING)
    return _clamp(CORRECTION_SHARE * warmth, MAX_WHITE_BALANCE)


def _weighted_percentile(values: np.ndarray, weights: np.ndarray, percent: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    index = np.searchsorted(cumulative, percent / 100.0 * cumulative[-1])
    return float(values[order][min(index, len(values) - 1)])


def _weighted_share(mask: np.ndarray, weights: np.ndarray) -> float:
    return float(weights[mask].sum() / weights.sum())


def _encoded(luminance: np.ndarray, adjust: ColorAdjust) -> np.ndarray:
    return linear_to_srgb(tone_curve(luminance, adjust))


def _solve_exposure(median: float, black_point: float) -> float:
    """Bisection: the tone curve is monotonic in exposure, so the target has one crossing."""
    low, high = -1.0, 1.0
    luminance = np.array([median])
    for _ in range(40):
        middle = (low + high) / 2
        landed = float(
            _encoded(luminance, ColorAdjust(exposure=middle, black_point=black_point))[0]
        )
        low, high = (middle, high) if landed < TARGET_MEDIAN else (low, middle)
    return (low + high) / 2


def _spread(encoded: np.ndarray, weights: np.ndarray) -> float:
    high = _weighted_percentile(encoded, weights, 95.0)
    return high - _weighted_percentile(encoded, weights, 5.0)


def _cast(linear: np.ndarray, weights: np.ndarray) -> tuple[float, float] | None:
    """Warmth and tint that would grey these pixels. Brighter ones count more: highlights
    carry the light's color, shadows the surfaces'."""
    grey_weights = weights * (linear @ LUMA) ** 2
    red, green, blue = (linear * grey_weights[:, None]).sum(axis=0)
    if min(red, green, blue) <= 0:
        return None
    warmth = -np.log(red / blue) / (2 * COLOR_ADJUST["warmth_gain"])
    tint = np.log(green / np.sqrt(red * blue)) / (2 * COLOR_ADJUST["tint_gain"])
    return float(warmth), float(tint)


def _white_balance(
    linear: np.ndarray, encoded_luma: np.ndarray, weights: np.ndarray
) -> tuple[float, float]:
    """Grey-world, refined onto the pixels that are grey once its own guess is undone. A cast
    tints the greys, so they can only be found after a first guess; with too few, stay put."""
    midtones = (encoded_luma > 0.2) & (encoded_luma < 0.95)
    estimate = _cast(linear[midtones], weights[midtones])
    for _ in range(WHITE_BALANCE_ROUNDS):
        if estimate is None:
            return 0.0, 0.0
        corrected = linear * white_balance_gains(*estimate)
        neutral = midtones & (_saturation(linear_to_srgb(corrected)) < NEUTRAL_SATURATION)
        if _weighted_share(neutral, weights) < MIN_NEUTRAL_SHARE:
            return 0.0, 0.0
        estimate = _cast(linear[neutral], weights[neutral])
    return estimate or (0.0, 0.0)


def _saturation(encoded: np.ndarray) -> np.ndarray:
    high = encoded.max(axis=-1)
    return np.where(high > 0, (high - encoded.min(axis=-1)) / np.maximum(high, 1e-12), 0.0)


def suggest_adjust(rgb: np.ndarray, weights: np.ndarray) -> ColorAdjust:
    """``rgb`` is ``(n, 3)`` sRGB-encoded in 0..1; ``weights`` how much each pixel counts."""
    if rgb.size == 0 or float(weights.sum()) <= 0:
        raise NothingToAnalyseError("There is nothing left to analyse")

    linear = srgb_to_linear(rgb.astype(np.float64))
    luminance = linear @ LUMA
    encoded_luma = linear_to_srgb(luminance)

    floor = _weighted_percentile(encoded_luma, weights, 0.5)
    black_point = 0.0
    if floor > HAZE_FLOOR:
        black_point = (floor - BLACK_TARGET) / COLOR_ADJUST["black_point_level"]
    black_point = _clamp(black_point)

    median = float(srgb_to_linear(np.array(_weighted_percentile(encoded_luma, weights, 50.0))))
    exposure = _clamp(CORRECTION_SHARE * _solve_exposure(median, black_point), MAX_EXPOSURE)

    levelled = _encoded(luminance, ColorAdjust(exposure=exposure, black_point=black_point))
    clipped = _weighted_share(levelled > CLIPPED_LEVEL, weights)
    deep = _weighted_share(levelled < DEEP_SHADOW_LEVEL, weights)
    highlights = (
        _clamp(-(clipped - CLIPPED_ALLOWANCE) * 8.0) if clipped > CLIPPED_ALLOWANCE else 0.0
    )
    shadows = _clamp((deep - DEEP_SHADOW_ALLOWANCE) * 2.0) if deep > DEEP_SHADOW_ALLOWANCE else 0.0

    flatness = max(0.0, FLAT_SPREAD - _spread(levelled, weights)) / FLAT_SPREAD
    contrast = _clamp(CORRECTION_SHARE * flatness, MAX_CONTRAST)

    saturation = _saturation(rgb)
    warmth, tint = _white_balance(linear, encoded_luma, weights)

    mean_saturation = float((saturation * weights).sum() / weights.sum())
    dullness = max(0.0, DULL_SATURATION - mean_saturation) / DULL_SATURATION
    vibrance = min(MAX_VIBRANCE, CORRECTION_SHARE * dullness)

    return ColorAdjust(
        exposure=exposure,
        black_point=black_point,
        highlights=highlights,
        shadows=shadows,
        contrast=contrast,
        warmth=_cooled_or_warmed(warmth),
        tint=_clamp(CORRECTION_SHARE * tint, MAX_WHITE_BALANCE),
        vibrance=_clamp(vibrance),
    )


def _frame_weights(
    shape: tuple[int, int], masks: Sequence[MaskRegion], crop: EditCropRect | None
) -> tuple[np.ndarray, tuple[slice, slice]]:
    """Masked pixels count for nothing; the slices cut the crop out of the frame."""
    height, width = shape
    weights = np.ones(shape, dtype=np.float64)
    for region in masks:
        top, bottom = round(region.y * height), round((region.y + region.height) * height)
        left, right = round(region.x * width), round((region.x + region.width) * width)
        weights[top:bottom, left:right] = 0.0

    if crop is None:
        return weights, (slice(None), slice(None))
    rows = slice(round(crop.y * height), max(round((crop.y + crop.height) * height), 1))
    columns = slice(round(crop.x * width), max(round((crop.x + crop.width) * width), 1))
    return weights, (rows, columns)


def _flattened(
    rgba: np.ndarray, masks: Sequence[MaskRegion], crop: EditCropRect | None
) -> tuple[np.ndarray, np.ndarray]:
    weights, (rows, columns) = _frame_weights(rgba.shape[:2], masks, crop)
    weights = weights * (rgba[..., 3] if rgba.shape[-1] == 4 else 1.0)
    rgb = rgba[rows, columns, :3].reshape(-1, 3)
    return rgb, weights[rows, columns].reshape(-1)


def image_analysis_pixels(
    source: Path, masks: Sequence[MaskRegion], crop: EditCropRect | None
) -> tuple[np.ndarray, np.ndarray]:
    """The whole frame is shrunk first: crop and masks are fractions, so they cut the same pixels."""
    image, _, _ = load_image_for_edit(source)
    image.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE), Image.Resampling.BOX)
    rgba = np.asarray(image, dtype=np.float64) / 255.0
    return _flattened(rgba, masks, crop)


def _sample_times(start: float, end: float) -> list[float]:
    step = (end - start) / VIDEO_SAMPLE_FRAMES
    return [start + step * (index + 0.5) for index in range(VIDEO_SAMPLE_FRAMES)]


def video_analysis_pixels(
    source: Path,
    masks: Sequence[MaskRegion],
    crop: EditCropRect | None,
    *,
    start: float,
    end: float | None,
    duration: float | None,
) -> tuple[np.ndarray, np.ndarray]:
    """Frames spread over the kept range, each read like a still. Always ``release()``: an
    unopened capture still locks the file on Windows."""
    import cv2

    stop = end if end is not None else duration
    times = _sample_times(start, stop) if stop is not None and stop > start else [start]
    pixels: list[np.ndarray] = []
    weights: list[np.ndarray] = []

    capture = cv2.VideoCapture(str(source))
    try:
        for seconds in times:
            capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000.0)
            read, frame = capture.read()
            if not read or frame is None:
                continue
            height, width = frame.shape[:2]
            factor = min(1.0, VIDEO_ANALYSIS_SIDE / max(height, width))
            if factor < 1.0:
                size = (max(1, round(width * factor)), max(1, round(height * factor)))
                frame = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).astype(np.float64) / 255.0
            frame_pixels, frame_weights = _flattened(rgb, masks, crop)
            pixels.append(frame_pixels)
            weights.append(frame_weights)
    finally:
        capture.release()

    if not pixels:
        raise NothingToAnalyseError("No frame of the video could be read")
    return np.concatenate(pixels), np.concatenate(weights)
