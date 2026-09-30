"""The Adjust tools' global tone and color, as one per-pixel function baked into a 3D LUT.

The TS port in ``frontend/src/features/gallery/lib/colorAdjust.ts`` must match it; the parity
cases ``scripts/generate_types.py`` emits from :func:`adjust_pixels` hold the two together.
"""

from __future__ import annotations

from math import cos, radians, sin
from pathlib import Path

import numpy as np
from PIL import ImageFilter

from constants import ADJUST_RENDER_LUT_SIZE, COLOR_ADJUST
from schemas import ColorAdjust

IDENTITY_EPSILON = 1e-9

#: Rec. 709 luminance of linear RGB.
LUMA = np.array([0.2126, 0.7152, 0.0722])

#: Tools a LUT carries; ``definition`` and ``noise_reduction`` look at neighbours and cannot.
GLOBAL_TOOLS = (
    "exposure",
    "brilliance",
    "highlights",
    "shadows",
    "contrast",
    "brightness",
    "black_point",
    "saturation",
    "vibrance",
    "warmth",
    "tint",
    "hue",
)

_DARK_LUMINANCE = 1e-6


def is_adjust_identity(adjust: ColorAdjust) -> bool:
    return all(abs(value) < IDENTITY_EPSILON for value in adjust.model_dump().values())


def is_global_identity(adjust: ColorAdjust) -> bool:
    return all(abs(getattr(adjust, tool)) < IDENTITY_EPSILON for tool in GLOBAL_TOOLS)


def srgb_to_linear(encoded: np.ndarray) -> np.ndarray:
    return np.where(encoded <= 0.04045, encoded / 12.92, ((encoded + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(linear: np.ndarray) -> np.ndarray:
    linear = np.clip(linear, 0.0, 1.0)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def white_balance_gains(warmth: float, tint: float) -> np.ndarray:
    """Positive tint is magenta. Normalised so a grey keeps its luminance."""
    log_gains = COLOR_ADJUST["warmth_gain"] * warmth * np.array([1.0, 0.0, -1.0])
    log_gains += COLOR_ADJUST["tint_gain"] * tint * np.array([1.0, -1.0, 1.0])
    gains = np.exp(log_gains)
    return gains / float(LUMA @ gains)


def _exposed(luminance: np.ndarray, exposure: float) -> np.ndarray:
    """A plain gain darkens; brightening rolls off so white stays white."""
    gain = 2.0 ** (COLOR_ADJUST["exposure_stops"] * exposure)
    if gain >= 1.0:
        return gain * luminance / (1.0 + (gain - 1.0) * luminance)
    return gain * luminance


def _shadows(p: np.ndarray, amount: float) -> np.ndarray:
    k = COLOR_ADJUST["shadow_lift"] if amount > 0 else COLOR_ADJUST["shadow_crush"]
    return p * (1.0 + amount * k * (1.0 - p) ** 3)


def _highlights(p: np.ndarray, amount: float) -> np.ndarray:
    k = COLOR_ADJUST["highlight_recover"] if amount < 0 else COLOR_ADJUST["highlight_lift"]
    return 1.0 - (1.0 - p) * (1.0 - amount * k * p**3)


def _contrast(p: np.ndarray, amount: float) -> np.ndarray:
    return p + amount * (p * p * (3.0 - 2.0 * p) - p)


def _brightness(p: np.ndarray, amount: float) -> np.ndarray:
    return p + COLOR_ADJUST["brightness_gain"] * amount * p * (1.0 - p)


def _black_point(p: np.ndarray, amount: float) -> np.ndarray:
    if amount > 0:
        level = COLOR_ADJUST["black_point_level"] * amount
        return np.maximum(0.0, (p - level) / (1.0 - level))
    lift = -COLOR_ADJUST["black_point_lift"] * amount
    return lift + (1.0 - lift) * p


def _clamp_unit(value: float) -> float:
    return max(-1.0, min(1.0, value))


def tone_curve(luminance: np.ndarray, adjust: ColorAdjust) -> np.ndarray:
    """Linear luminance in and out; every stage is monotonic and exactly identity at 0."""
    p = linear_to_srgb(_exposed(luminance, adjust.exposure))

    b = adjust.brilliance
    p = _shadows(p, _clamp_unit(COLOR_ADJUST["brilliance_shadows"] * b))
    p = _highlights(p, _clamp_unit(-COLOR_ADJUST["brilliance_highlights"] * b))
    p = _contrast(p, _clamp_unit(COLOR_ADJUST["brilliance_contrast"] * b))

    p = _highlights(p, adjust.highlights)
    p = _shadows(p, adjust.shadows)
    p = _contrast(p, adjust.contrast)
    p = _brightness(p, adjust.brightness)
    p = _black_point(p, adjust.black_point)
    return srgb_to_linear(np.clip(p, 0.0, 1.0))


def hue_matrix(degrees: float) -> np.ndarray:
    """The CSS ``hue-rotate()`` matrix: turns chroma and keeps its luma."""
    c = cos(radians(degrees))
    s = sin(radians(degrees))
    lr, lg, lb = 0.213, 0.715, 0.072
    return np.array(
        [
            [lr + c * (1 - lr) - s * lr, lg - c * lg - s * lg, lb - c * lb + s * (1 - lb)],
            [lr - c * lr + s * 0.143, lg + c * (1 - lg) + s * 0.140, lb - c * lb - s * 0.283],
            [lr - c * lr - s * (1 - lr), lg - c * lg + s * lg, lb + c * (1 - lb) + s * lb],
        ]
    )


def fit_gamut(linear: np.ndarray) -> np.ndarray:
    """Pull out-of-range colors toward their own grey: luminance and hue stay, chroma gives."""
    grey = np.clip(linear @ LUMA, 0.0, 1.0)[..., None]
    offset = linear - grey
    with np.errstate(divide="ignore", invalid="ignore"):
        over = np.where(linear > 1.0, (1.0 - grey) / offset, np.inf)
        under = np.where(linear < 0.0, grey / -offset, np.inf)
    scale = np.clip(np.minimum(over, under).min(axis=-1, keepdims=True), 0.0, 1.0)
    return grey + offset * scale


def adjust_pixels(rgb: np.ndarray, adjust: ColorAdjust) -> np.ndarray:
    """sRGB-encoded ``(..., 3)`` in 0..1 to the same, through every global tool."""
    linear = srgb_to_linear(np.asarray(rgb, dtype=np.float64))
    linear = linear * white_balance_gains(adjust.warmth, adjust.tint)

    luminance = linear @ LUMA
    toned = tone_curve(luminance, adjust)
    dark = luminance <= _DARK_LUMINANCE
    safe = np.where(dark, 1.0, luminance)
    ratio = np.where(dark, 0.0, toned / safe)
    chroma_gain = np.minimum(ratio, COLOR_ADJUST["tone_chroma_cap"])
    linear = toned[..., None] + (linear - luminance[..., None]) * chroma_gain[..., None]

    spread = linear.max(axis=-1) - linear.min(axis=-1)
    saturation = np.where(
        linear.max(axis=-1) > 0, spread / np.maximum(linear.max(axis=-1), 1e-12), 0
    )
    chroma = (1.0 + adjust.saturation) * (1.0 + adjust.vibrance * (1.0 - saturation))
    linear = toned[..., None] + (linear - toned[..., None]) * chroma[..., None]

    if abs(adjust.hue) > IDENTITY_EPSILON:
        linear = linear @ hue_matrix(adjust.hue).T

    return linear_to_srgb(fit_gamut(linear))


def adjust_lut(adjust: ColorAdjust, size: int = ADJUST_RENDER_LUT_SIZE) -> np.ndarray:
    """``(size, size, size, 3)`` indexed ``[b, g, r]``: red varies fastest, as .cube and Pillow read it."""
    axis = np.linspace(0.0, 1.0, size)
    blue, green, red = np.meshgrid(axis, axis, axis, indexing="ij")
    return adjust_pixels(np.stack([red, green, blue], axis=-1), adjust).astype(np.float32)


def lut_filter(adjust: ColorAdjust) -> ImageFilter.Color3DLUT:
    """Three channels, so an alpha band passes through untouched."""
    return ImageFilter.Color3DLUT(ADJUST_RENDER_LUT_SIZE, adjust_lut(adjust))


def write_cube(path: Path, lut: np.ndarray) -> None:
    size = lut.shape[0]
    with path.open("w", encoding="ascii", newline="\n") as cube:
        cube.write(f"LUT_3D_SIZE {size}\n")
        np.savetxt(cube, lut.reshape(-1, 3), fmt="%.6f")
