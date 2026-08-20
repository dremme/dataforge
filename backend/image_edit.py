"""Crop, mirror, rotate and rescale one image in place, from its untouched original.

Every render reads ``photo.jpg.bak`` rather than ``photo.jpg``. The backup is written the
first time a file is edited and is never rewritten, so a spec always describes the
finished result rather than a step on top of the last one: rotating an already-cropped
file keeps the crop, and no edit ever resamples a resample.

That is also why the spec is kept beside the file, in ``photo.edit.json``. Without it the
editor would re-open on an already-cropped image with an empty draft, and the next apply
would silently drop the crop.

Unlike ``video_edit``, nothing here is truncated to an even number of pixels: that rule
exists because ``yuv420p`` cannot express an odd dimension, and a still has no chroma
plane to keep in step. ``frontend/src/features/gallery/lib/imageEdit.ts`` rounds the same
way, because the panel promises an output size before the render exists.
"""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

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
from schemas import EditCropRect, ImageEditResponse, ImageEditSpec

IDENTITY_EPSILON = 1e-9

#: Pillow's ``ROTATE_*`` turn counter-clockwise; the spec's ``rotate`` is clockwise
#: degrees, matching the arrows on the panel's buttons. Do not "align" these names.
_CLOCKWISE_TRANSPOSE = {
    90: Image.Transpose.ROTATE_270,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_90,
}


def read_image_edit_spec(media: Path) -> ImageEditSpec | None:
    return read_spec(media, ImageEditSpec)


def is_identity_spec(spec: ImageEditSpec) -> bool:
    """Whether applying ``spec`` would re-encode the original into itself."""
    return (
        spec.crop is None
        and not spec.mirror_h
        and not spec.mirror_v
        and spec.rotate == 0
        and abs(spec.scale - 1.0) < IDENTITY_EPSILON
    )


def resolve_image_format(media: Path) -> str:
    """The suffix to write as, since the temp file carries no media suffix of its own."""
    suffix = media.suffix.lower()
    if suffix not in IMAGE_EDIT_EXTENSIONS:
        raise ValueError(f"{media.suffix} images cannot be edited")
    return suffix


def crop_box(size: tuple[int, int], crop: EditCropRect) -> tuple[int, int, int, int]:
    """The crop, in whole pixels of a frame of ``size``.

    Rounded on each edge rather than by width and offset separately, so a rectangle that
    reaches the frame's edge in fractions still reaches it in pixels. Clamped so a spec
    validated to within an epsilon of 1.0 cannot ask Pillow for a row that is not there.
    """
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


def render_image_edit(image: Image.Image, spec: ImageEditSpec) -> Image.Image:
    """Apply the whole spec, in its one fixed order: crop, mirror, rotate, scale.

    Crop comes first because it is expressed against the source frame - that is what lets
    the crop overlay hand over the rectangle it measured without undoing a rotation first.
    Scale comes last so it resamples once, over the pixels that survive.
    """
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
    """Render ``spec`` from the original and put the result back under ``media``'s name.

    On any failure the live file is left byte-identical. The backup created on the way in
    survives that failure on purpose: dropping it would mean the next attempt re-copies,
    and if this one did damage the output there would be nothing left to copy from.
    """
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
    """Put the untouched original back and forget the edit that replaced it."""
    restore_backup(media)

    return describe_edited(media, has_backup=False)
