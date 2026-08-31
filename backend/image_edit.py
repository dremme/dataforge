"""Obscure, crop, mirror, rotate and rescale one image in place from its untouched original. Odd dimensions are kept: a still has no yuv420p chroma plane."""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime
from math import ceil
from pathlib import Path

from PIL import Image, ImageFilter

from constants import IMAGE_EDIT_EXTENSIONS
from edit_sidecars import (
    ensure_backup,
    read_spec,
    restore_backup,
    stale_path_for,
    sweep_edit_temp_files,
    temp_path_for,
    write_spec,
)
from file_publish import publish_replacing
from image_io import load_image_for_edit, save_image_preserving_format
from media_dimensions import media_dimensions
from schemas import EditCropRect, ImageEditResponse, ImageEditSpec, MaskRegion

IDENTITY_EPSILON = 1e-9

#: A mosaic block hides about as much as a Gaussian a quarter its size; one strength serves both.
BLUR_RADIUS_DIVISOR = 4

#: Pillow's ``ROTATE_*`` are counter-clockwise; the spec's ``rotate`` is clockwise.
_CLOCKWISE_TRANSPOSE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


def read_image_edit_spec(media: Path) -> ImageEditSpec | None:
    return read_spec(media, ImageEditSpec)


def is_identity_spec(spec: ImageEditSpec) -> bool:
    return (
        not spec.masks
        and spec.crop is None
        and not spec.mirror_h
        and not spec.mirror_v
        and spec.rotate == 0
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
    )


def resolve_image_format(media: Path) -> str:
    suffix = media.suffix.lower()
    if suffix not in IMAGE_EDIT_EXTENSIONS:
        raise ValueError(f"{media.suffix} images cannot be edited")
    return suffix


def crop_box(size: tuple[int, int], crop: EditCropRect) -> tuple[int, int, int, int]:
    """Rounded per edge so a rect that reaches the frame still reaches it in pixels."""
    width, height = size
    left = min(round(width * crop.x), width - 1)
    top = min(round(height * crop.y), height - 1)
    right = min(round(width * (crop.x + crop.width)), width)
    bottom = min(round(height * (crop.y + crop.height)), height)
    return left, top, max(right, left + 1), max(bottom, top + 1)


def scaled_size(size: tuple[int, int], scale: float) -> tuple[int, int]:
    """At least one pixel on each axis: a 5% scale of a thumbnail can round to zero."""
    width, height = size
    return max(1, round(width * scale)), max(1, round(height * scale))


def blurred_region(
    image: Image.Image, box: tuple[int, int, int, int], radius: float
) -> Image.Image:
    """Blurred against real neighbours: a bare patch clamps at its own edge and leaves a seam."""
    left, top, right, bottom = box
    pad = ceil(radius * 2)
    outer = (
        max(0, left - pad),
        max(0, top - pad),
        min(image.width, right + pad),
        min(image.height, bottom + pad),
    )
    blurred = image.crop(outer).filter(ImageFilter.GaussianBlur(radius))
    return blurred.crop((left - outer[0], top - outer[1], right - outer[0], bottom - outer[1]))


def pixelated_region(image: Image.Image, box: tuple[int, int, int, int], block: int) -> Image.Image:
    """BOX down then NEAREST up: averaged blocks with hard edges, aligned to the region."""
    patch = image.crop(box)
    width, height = patch.size
    reduced = (max(1, width // block), max(1, height // block))
    return patch.resize(reduced, Image.Resampling.BOX).resize(patch.size, Image.Resampling.NEAREST)


def mask_extent(box: tuple[int, int, int, int], strength: float) -> float:
    """Strength is a fraction of the shorter side, so it reads the same at any region size."""
    left, top, right, bottom = box
    return strength * min(right - left, bottom - top)


def masked_image(image: Image.Image, regions: list[MaskRegion]) -> Image.Image:
    """Copied first: the caller's image is the loaded original and stays untouched."""
    masked = image.copy()

    for region in regions:
        box = crop_box(masked.size, region)
        extent = mask_extent(box, region.strength)
        patch = (
            pixelated_region(masked, box, max(1, round(extent)))
            if region.mode == "pixelate"
            else blurred_region(masked, box, max(1.0, extent / BLUR_RADIUS_DIVISOR))
        )
        masked.paste(patch, box)

    return masked


def render_image_edit(image: Image.Image, spec: ImageEditSpec) -> Image.Image:
    """Order is mask, crop, mirror, rotate, scale."""
    if spec.masks:
        image = masked_image(image, spec.masks)

    if spec.crop is not None:
        image = image.crop(crop_box(image.size, spec.crop))

    if spec.mirror_h:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if spec.mirror_v:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)

    if spec.rotate:
        image = image.transpose(_CLOCKWISE_TRANSPOSE[spec.rotate])

    if abs(spec.scale - 1.0) > IDENTITY_EPSILON:
        image = image.resize(scaled_size(image.size, spec.scale), Image.Resampling.LANCZOS)

    return image


def describe_edited(media: Path, *, has_backup: bool) -> ImageEditResponse:
    stat = media.stat()
    dimensions = media_dimensions(media, "image", stat.st_mtime_ns, stat.st_size)
    return ImageEditResponse(
        path=str(media),
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        width=dimensions[0] if dimensions else None,
        height=dimensions[1] if dimensions else None,
        has_backup=has_backup,
    )


def apply_image_edit(media: Path, spec: ImageEditSpec) -> ImageEditResponse:
    """Render ``spec`` from the original. On failure the live file is left byte-identical."""
    suffix = resolve_image_format(media)
    sweep_edit_temp_files(media.parent)

    source = ensure_backup(media)
    temp_path = temp_path_for(media)

    try:
        image, source_mode, exif = load_image_for_edit(source)
        save_image_preserving_format(
            render_image_edit(image, spec),
            temp_path,
            suffix=suffix,
            source_mode=source_mode,
            exif=exif,
        )
        publish_replacing(temp_path, media, stale_path_for(media))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    write_spec(media, spec)
    return describe_edited(media, has_backup=True)


def revert_image_edit(media: Path) -> ImageEditResponse:
    restore_backup(media)

    return describe_edited(media, has_backup=False)
