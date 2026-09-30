"""Noise reduction and definition: the two Adjust tools that look at neighbouring pixels.

Both run on BT.709 full-range YCbCr before the global LUT. The math is picked so ffmpeg's
``guided``/``gblur``/``lut2`` and the WebGL preview compute the same thing as this module.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from constants import COLOR_DETAIL
from schemas import ColorAdjust

IDENTITY_EPSILON = 1e-9

_KR, _KB = 0.2126, 0.0722
_KG = 1.0 - _KR - _KB
_CB_SCALE = 2.0 * (1.0 - _KB)
_CR_SCALE = 2.0 * (1.0 - _KR)


@dataclass(frozen=True, slots=True)
class NoiseParams:
    luma_radius: int
    luma_eps: float
    chroma_radius: int
    chroma_eps: float


@dataclass(frozen=True, slots=True)
class DefinitionParams:
    """The blurred base is taken at ``size`` so its reach is a fixed share of the frame."""

    size: tuple[int, int]
    sigma: float
    gain: float
    knee: float


def is_detail_identity(adjust: ColorAdjust) -> bool:
    return adjust.noise_reduction < IDENTITY_EPSILON and adjust.definition < IDENTITY_EPSILON


def noise_params(strength: float) -> NoiseParams:
    """``eps`` is a variance: ffmpeg's ``guided`` takes it as is, it does not square it."""
    return NoiseParams(
        luma_radius=int(COLOR_DETAIL["noise_luma_radius"]),
        luma_eps=(COLOR_DETAIL["noise_luma_std"] * strength) ** 2,
        chroma_radius=int(COLOR_DETAIL["noise_chroma_radius"]),
        chroma_eps=(COLOR_DETAIL["noise_chroma_std"] * strength) ** 2,
    )


def definition_params(strength: float, frame: tuple[int, int]) -> DefinitionParams:
    width, height = frame
    short_side = COLOR_DETAIL["definition_short_side"]
    factor = min(1.0, short_side / min(width, height))
    size = (max(1, round(width * factor)), max(1, round(height * factor)))
    return DefinitionParams(
        size=size,
        sigma=COLOR_DETAIL["definition_sigma"] * min(size) / short_side,
        gain=COLOR_DETAIL["definition_gain"] * strength,
        knee=COLOR_DETAIL["definition_knee"],
    )


def rgb_to_ycbcr(rgb: np.ndarray) -> np.ndarray:
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    luma = _KR * red + _KG * green + _KB * blue
    return np.stack(
        [luma, (blue - luma) / _CB_SCALE + 0.5, (red - luma) / _CR_SCALE + 0.5], axis=-1
    )


def ycbcr_to_rgb(ycc: np.ndarray) -> np.ndarray:
    luma = ycc[..., 0]
    red = luma + _CR_SCALE * (ycc[..., 2] - 0.5)
    blue = luma + _CB_SCALE * (ycc[..., 1] - 0.5)
    green = (luma - _KR * red - _KB * blue) / _KG
    return np.stack([red, green, blue], axis=-1)


def _box(plane: np.ndarray, radius: int) -> np.ndarray:
    size = 2 * radius + 1
    return cv2.boxFilter(plane, -1, (size, size), normalize=True, borderType=cv2.BORDER_REPLICATE)


def guided_filter(plane: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """Self-guided (He et al.): flattens variation below ``eps`` and keeps the edges above it."""
    plane = np.ascontiguousarray(plane)
    mean = _box(plane, radius)
    variance = _box(plane * plane, radius) - mean * mean
    a = variance / (variance + eps)
    b = mean - a * mean
    return _box(a, radius) * plane + _box(b, radius)


def blurred_base(luma: np.ndarray, params: DefinitionParams) -> np.ndarray:
    height, width = luma.shape
    small = cv2.resize(luma, params.size, interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), params.sigma, borderType=cv2.BORDER_REPLICATE)
    return cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)


def defined_luma(luma: np.ndarray, base: np.ndarray, params: DefinitionParams) -> np.ndarray:
    """Midtones gain local contrast; the knee holds big edges back so they do not halo."""
    detail = luma - base
    limited = detail / (1.0 + np.abs(detail) / params.knee)
    return np.clip(luma + params.gain * limited * 4.0 * luma * (1.0 - luma), 0.0, 1.0)


def apply_detail(rgb: np.ndarray, adjust: ColorAdjust) -> np.ndarray:
    """sRGB-encoded float ``(h, w, 3)`` in 0..1 in and out."""
    ycc = rgb_to_ycbcr(rgb.astype(np.float32))

    if adjust.noise_reduction >= IDENTITY_EPSILON:
        params = noise_params(adjust.noise_reduction)
        ycc[..., 0] = guided_filter(ycc[..., 0], params.luma_radius, params.luma_eps)
        for channel in (1, 2):
            ycc[..., channel] = guided_filter(
                ycc[..., channel], params.chroma_radius, params.chroma_eps
            )

    if adjust.definition >= IDENTITY_EPSILON:
        height, width = ycc.shape[:2]
        params = definition_params(adjust.definition, (width, height))
        luma = np.ascontiguousarray(ycc[..., 0])
        ycc[..., 0] = defined_luma(luma, blurred_base(luma, params), params)

    return np.clip(ycbcr_to_rgb(ycc), 0.0, 1.0)
