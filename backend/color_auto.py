"""The Adjust wand: read an image or a clip and suggest tool positions toward a natural look.

It fixes levels, harsh contrast, loud or dull colour and casts, and leaves alone a frame that is
already within natural bounds. Suggestions are partial, so a second run changes little.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from PIL import Image

from color_adjust import (
    GLOBAL_TOOLS,
    LUMA,
    linear_to_srgb,
    srgb_to_linear,
    tone_curve,
    white_balance_gains,
)
from constants import ADJUST_MAX_HUE, AUTO_ADJUST_DEFAULT_AMOUNT, COLOR_ADJUST
from image_io import load_image_for_edit
from schemas import AutoAdjust, ColorAdjust, EditCropRect, MaskRegion

logger = logging.getLogger(__name__)

#: Long side the analysis reads at; statistics settle long before full resolution.
ANALYSIS_SIDE = 512
VIDEO_ANALYSIS_SIDE = 256
VIDEO_SAMPLE_FRAMES = 8

#: Well-exposed footage keeps its median anywhere in this band of encoded luminance. Outside it
#: the wand closes a share of the gap past the edge, so the move grows from nothing at the edge.
DARK_MEDIAN = 0.34
BRIGHT_MEDIAN = 0.62
MEDIAN_GAP_GAIN = 1.5
DARK_TARGET = 0.42
BRIGHT_TARGET = 0.52
#: Brightening stops where the brightest percentile would land, so it never blows highlights.
HEADROOM_PERCENTILE = 99.0
HEADROOM_TARGET = 0.93
#: Share of each measured correction the wand applies.
CORRECTION_SHARE = 0.5
MAX_SUGGESTION = 0.5
#: Dark and bright scenes are often meant that way, so exposure moves less than the rest.
MAX_EXPOSURE = 0.3
MAX_WHITE_BALANCE = 0.25
MAX_CONTRAST = 0.3
MAX_VIBRANCE = 0.25
MAX_DESATURATION = 0.3
#: A warm scene reads like a warm cast, and cooling a sunset is the worse mistake.
COOLING_SHARE = 0.25
MAX_COOLING = 0.1
#: Foliage reads like a green cast, so tint moves less than warmth.
TINT_SHARE = 0.35
MAX_TINT = 0.15
#: Below this a suggestion is noise, and a tool the user did not ask about should stay at 0.
DEAD_ZONE = 0.03

#: A floor above this reads as haze; the correction ramps in over the next stretch, so a floor
#: just past it is barely touched.
HAZE_FLOOR = 0.08
HAZE_RAMP = 0.05
BLACK_TARGET = 0.01
#: Whites short of this get a white point; a dull white is the bright end's haze.
WHITE_PERCENTILE = 99.5
WHITE_TARGET = 0.95
CLIPPED_LEVEL = 0.97
CLIPPED_ALLOWANCE = 0.01
DEEP_SHADOW_LEVEL = 0.1
DEEP_SHADOW_ALLOWANCE = 0.15
FLAT_SPREAD = 0.6
#: Crushed blacks and blown whites together; past this share the contrast is harsh.
EXTREME_LOW = 0.04
EXTREME_HIGH = 0.96
HARSH_EXTREMES = 0.08
HARSH_GAIN = 1.5
#: Pure black and white in the source; no tone tool moves them, so they count as neither clipped
#: nor deep in shadow, or the wand would keep asking for what it cannot do.
PINNED_MARGIN = 1.5 / 255
#: Oversaturation pins a channel at 0 or 1 in pixels that are neither dark nor white; natural
#: colour almost never does. Dark pixels are left out: a night sky pins its red channel honestly.
PINNED_LOW = 0.35
PINNED_HIGH = 0.95
PINNED_CHANNEL = 0.015
PINNED_ALLOWANCE = 0.05
PINNED_GAIN = 1.5
#: Hasler and Susstrunk's colourfulness, in 0..1 units: "highly colourful" ends near 0.26.
LOUD_COLOURFULNESS = 0.26
LOUD_GAIN = 2.0
DULL_COLOURFULNESS = 0.1
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


def _solve(encoded: float, target: float, tool: str, fixed: ColorAdjust) -> float:
    """Bisection over one tone tool: every stage is monotonic, so the target has one crossing."""
    low, high = -1.0, 1.0
    luminance = srgb_to_linear(np.array([encoded]))
    for _ in range(40):
        middle = (low + high) / 2
        landed = float(_encoded(luminance, fixed.model_copy(update={tool: middle}))[0])
        low, high = (middle, high) if landed < target else (low, middle)
    return (low + high) / 2


def _midtones(
    encoded_luma: np.ndarray, weights: np.ndarray, levels: ColorAdjust
) -> tuple[float, float]:
    """Exposure and brightness, judged on where the median lands after ``levels``. Brightening
    uses exposure, which rolls off before white; darkening uses brightness, which keeps white
    where a plain gain would grey it."""
    median = _weighted_percentile(encoded_luma, weights, 50.0)
    landed = float(_encoded(srgb_to_linear(np.array([median])), levels)[0])
    if landed > BRIGHT_MEDIAN:
        target = max(BRIGHT_TARGET, landed - MEDIAN_GAP_GAIN * (landed - BRIGHT_MEDIAN))
        return 0.0, _clamp(min(0.0, _solve(median, target, "brightness", levels)), MAX_EXPOSURE)
    if landed >= DARK_MEDIAN:
        return 0.0, 0.0
    target = min(DARK_TARGET, landed + MEDIAN_GAP_GAIN * (DARK_MEDIAN - landed))
    brightest = _weighted_percentile(encoded_luma, weights, HEADROOM_PERCENTILE)
    lift = min(
        _solve(median, target, "exposure", levels),
        _solve(brightest, HEADROOM_TARGET, "exposure", levels),
    )
    return _clamp(max(0.0, lift), MAX_EXPOSURE), 0.0


def _levels(toned: np.ndarray, weights: np.ndarray) -> ColorAdjust:
    """Black and white point, read after the midtone move, which shifts both ends. The black
    point never sinks the median into the dark band: in a low-contrast frame the floor sits
    close to the median, and clearing it would clear the subject."""
    floor = _weighted_percentile(toned, weights, 0.5)
    median = _weighted_percentile(toned, weights, 50.0)
    haze = min(1.0, max(0.0, (floor - HAZE_FLOOR) / HAZE_RAMP))
    black_level = min(
        CORRECTION_SHARE * haze * (floor - BLACK_TARGET),
        max(0.0, (median - DARK_MEDIAN) / (1.0 - DARK_MEDIAN)),
    )
    black_point = _clamp(black_level / COLOR_ADJUST["black_point_level"])
    black_level = COLOR_ADJUST["black_point_level"] * black_point
    ceiling = (_weighted_percentile(toned, weights, WHITE_PERCENTILE) - black_level) / (
        1.0 - black_level
    )
    white_level = CORRECTION_SHARE * max(0.0, 1.0 - ceiling / WHITE_TARGET)
    white_point = _clamp(white_level / COLOR_ADJUST["white_point_level"])
    return ColorAdjust(black_point=black_point, white_point=white_point)


def _contrast(levelled: np.ndarray, weights: np.ndarray, deep: float) -> float:
    """Harsh footage is softened. A flat one is only steepened when it is neither dark nor deep in
    shadow, since steeper midtones would sink what the shadows and exposure lift."""
    extremes = _weighted_share((levelled < EXTREME_LOW) | (levelled > EXTREME_HIGH), weights)
    if extremes > HARSH_EXTREMES:
        return -_clamp((extremes - HARSH_EXTREMES) * HARSH_GAIN + DEAD_ZONE, MAX_CONTRAST)
    if deep > DEEP_SHADOW_ALLOWANCE or _weighted_percentile(levelled, weights, 50.0) < DARK_MEDIAN:
        return 0.0
    flatness = max(0.0, FLAT_SPREAD - _spread(levelled, weights)) / FLAT_SPREAD
    return _clamp(CORRECTION_SHARE * flatness, MAX_CONTRAST)


def _colourfulness(rgb: np.ndarray, weights: np.ndarray) -> float:
    share = weights / weights.sum()
    red_green = rgb[:, 0] - rgb[:, 1]
    yellow_blue = 0.5 * (rgb[:, 0] + rgb[:, 1]) - rgb[:, 2]
    means = np.array([red_green @ share, yellow_blue @ share])
    spreads = np.array(
        [
            np.sqrt(((red_green - means[0]) ** 2) @ share),
            np.sqrt(((yellow_blue - means[1]) ** 2) @ share),
        ]
    )
    return float(np.hypot(*spreads) + 0.3 * np.hypot(*means))


def _saturation_and_vibrance(
    rgb: np.ndarray, encoded_luma: np.ndarray, weights: np.ndarray
) -> tuple[float, float]:
    """Loud colour is pulled back with saturation; only dull colour is lifted, and gently."""
    lit = (encoded_luma > PINNED_LOW) & (encoded_luma < PINNED_HIGH)
    pinned = lit & ((rgb.min(axis=-1) < PINNED_CHANNEL) | (rgb.max(axis=-1) > 1 - PINNED_CHANNEL))
    pinned_share = _weighted_share(pinned, weights)
    colourfulness = _colourfulness(rgb, weights)

    cut = max(
        (pinned_share - PINNED_ALLOWANCE) * PINNED_GAIN if pinned_share > PINNED_ALLOWANCE else 0,
        (colourfulness - LOUD_COLOURFULNESS) * LOUD_GAIN,
        0.0,
    )
    if cut > 0:
        return -_clamp(cut + DEAD_ZONE, MAX_DESATURATION), 0.0

    dullness = max(0.0, DULL_COLOURFULNESS - colourfulness) / DULL_COLOURFULNESS
    return 0.0, _clamp(MAX_VIBRANCE * dullness, MAX_VIBRANCE)


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

    exposure, brightness = _midtones(encoded_luma, weights, ColorAdjust())
    levels = _levels(
        _encoded(luminance, ColorAdjust(exposure=exposure, brightness=brightness)), weights
    )
    exposure, brightness = _midtones(encoded_luma, weights, levels)
    levels = levels.model_copy(update={"exposure": exposure, "brightness": brightness})

    levelled = _encoded(luminance, levels)
    movable = (encoded_luma > PINNED_MARGIN) & (encoded_luma < 1 - PINNED_MARGIN)
    clipped = _weighted_share(movable & (levelled > CLIPPED_LEVEL), weights)
    deep = _weighted_share(movable & (levelled < DEEP_SHADOW_LEVEL), weights)
    highlights = (
        _clamp(-(clipped - CLIPPED_ALLOWANCE) * 8.0) if clipped > CLIPPED_ALLOWANCE else 0.0
    )
    shadows = _clamp((deep - DEEP_SHADOW_ALLOWANCE) * 2.0) if deep > DEEP_SHADOW_ALLOWANCE else 0.0

    contrast = _contrast(levelled, weights, deep)
    saturation, vibrance = _saturation_and_vibrance(rgb, encoded_luma, weights)
    warmth, tint = _white_balance(linear, encoded_luma, weights)

    return ColorAdjust(
        exposure=exposure,
        brightness=brightness,
        black_point=levels.black_point,
        white_point=levels.white_point,
        highlights=highlights,
        shadows=shadows,
        contrast=contrast,
        warmth=_cooled_or_warmed(warmth),
        tint=_clamp(TINT_SHARE * tint, MAX_TINT),
        saturation=saturation,
        vibrance=vibrance,
    )


def _tool_range(tool: str) -> tuple[float, float]:
    if tool == "hue":
        return -ADJUST_MAX_HUE, ADJUST_MAX_HUE
    return (-1.0, 1.0) if tool in GLOBAL_TOOLS else (0.0, 1.0)


def _shifted(adjust: ColorAdjust, suggestion: ColorAdjust, by: float) -> ColorAdjust:
    values = adjust.model_dump()
    for tool, value in suggestion.model_dump().items():
        low, high = _tool_range(tool)
        values[tool] = min(high, max(low, values[tool] + by * value))
    return ColorAdjust(**values)


def _share(amount: float) -> float:
    return amount / AUTO_ADJUST_DEFAULT_AMOUNT


def without_auto(adjust: ColorAdjust, auto: AutoAdjust) -> ColorAdjust:
    """Moves the user made on top of the wand survive its removal."""
    if auto.base is None:
        return _shifted(adjust, auto.suggestion, -_share(auto.amount))
    composed = _shifted(auto.base, auto.suggestion, _share(auto.amount))
    drift = ColorAdjust.model_construct(
        **{tool: value - getattr(composed, tool) for tool, value in adjust.model_dump().items()}
    )
    return _shifted(auto.base, drift, 1.0)


def with_auto(
    adjust: ColorAdjust, previous: AutoAdjust | None, suggestion: ColorAdjust
) -> tuple[ColorAdjust, AutoAdjust]:
    """What pressing the wand does: the earlier suggestion is swapped out at the default amount."""
    base = adjust if previous is None else without_auto(adjust, previous)
    return _shifted(base, suggestion, 1.0), AutoAdjust(suggestion=suggestion, base=base)


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
        raise ValueError("No frame of the video could be read")
    return np.concatenate(pixels), np.concatenate(weights)
