"""Target frame sizes for a megapixel budget on a pixel grid; mirrored in the frontend's editSpec."""

from __future__ import annotations

from math import floor, lcm, sqrt

from constants import MEGAPIXEL
from schemas import SizeFit


def _round_half_up(value: float) -> int:
    """``Math.round``, not banker's rounding, so both ports agree on a ``.5``."""
    return floor(value + 0.5)


def grid_multiple(fit: SizeFit, *, even: bool = False) -> int:
    """``even`` for video: ``yuv420p`` has no odd sizes, so the grid widens to a multiple of 2."""
    return lcm(fit.multiple, 2) if even else fit.multiple


def fitted_size(
    size: tuple[int, int], fit: SizeFit, *, even: bool = False
) -> tuple[int, int] | None:
    """The budget at ``size``'s aspect, each side rounded to the grid and never past the source.

    ``None`` when a side is shorter than one grid cell: reaching it would mean upscaling."""
    width, height = size
    multiple = grid_multiple(fit, even=even)
    if width <= 0 or height <= 0:
        return None
    largest = (width // multiple * multiple, height // multiple * multiple)
    if min(largest) == 0:
        return None

    scale = min(1.0, sqrt(fit.megapixels * MEGAPIXEL / (width * height)))
    target = (
        _round_half_up(width * scale / multiple) * multiple,
        _round_half_up(height * scale / multiple) * multiple,
    )
    return (
        max(multiple, min(target[0], largest[0])),
        max(multiple, min(target[1], largest[1])),
    )


def cover_size(size: tuple[int, int], target: tuple[int, int]) -> tuple[int, int]:
    """The even size that covers an even ``target`` at ``size``'s aspect, for a center crop.

    Floored, so an odd source at scale 1 is never stretched by a pixel."""
    width, height = size
    scale = max(target[0] / width, target[1] / height)
    return (
        max(target[0], floor(width * scale / 2) * 2),
        max(target[1], floor(height * scale / 2) * 2),
    )
