"""Read an image into editable pixels, and write it back without changing what it is.

Both halves used to live inside ``automation/watermark.py``, which was the only thing in
the tree that read pixels, changed them and wrote them out again. The in-place image
editor is the second, and it needs exactly the same two rules:

* everything that touches the source happens inside the ``with`` block, and the pixels
  outlive the handle - a lock still held on a multi-frame JPEG or APNG would otherwise
  race the destination write on Windows;
* the destination keeps the source's format, its alpha where the format has any, and its
  EXIF where the format carries any.

The format is named rather than inferred, because both callers write to a temp path that
deliberately carries no media suffix.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

JPEG_SUFFIXES = {".jpg", ".jpeg"}
JPEG_QUALITY = 92
WEBP_QUALITY = 92


class ImageReadError(Exception):
    """Raised when Pillow cannot open or decode the source."""


def load_image_for_edit(source: Path) -> tuple[Image.Image, str, Image.Exif]:
    """Return the source as detached RGBA pixels, plus its original mode and EXIF.

    Everything that touches the file happens inside the ``with`` block and the result
    outlives the handle, so the destination write can never race a lock still held on
    a multi-frame JPEG or APNG. See ``automation/vision.py`` for the same hazard.
    """
    try:
        with Image.open(source) as opened:
            opened.load()
            # Rotates the pixels and drops the Orientation tag, so an edit is expressed
            # against the frame the viewer sees rather than the one the sensor recorded.
            oriented = ImageOps.exif_transpose(opened) or opened
            return oriented.convert("RGBA"), oriented.mode, oriented.getexif()
    except OSError as exc:
        raise ImageReadError(str(exc)) from exc


def save_image_preserving_format(
    image: Image.Image,
    destination: Path,
    *,
    suffix: str,
    source_mode: str,
    exif: Image.Exif,
) -> None:
    """Write ``image`` to ``destination`` as the format ``suffix`` names.

    A source that arrived paletted comes back truecolor unless it carried transparency.
    Re-quantizing would be a second lossy pass over pixels that have already been
    resampled, and both callers keep the untouched original a revert away.
    """
    suffix = suffix.lower()

    if suffix in JPEG_SUFFIXES:
        # 4:4:4 rather than the default 4:2:0: chroma subsampling halves the resolution
        # of thin strokes and fine detail, which is exactly what a crop magnifies.
        image.convert("RGB").save(
            destination,
            format="JPEG",
            quality=JPEG_QUALITY,
            subsampling=0,
            optimize=True,
            **({"exif": exif.tobytes()} if exif else {}),
        )
        return

    if suffix == ".bmp":
        # BMP has no alpha a viewer can be relied on to read, so it is flattened rather
        # than written into a channel half the decoders in the world ignore.
        image.convert("RGB").save(destination, format="BMP")
        return

    keeps_alpha = source_mode in {"RGBA", "LA", "PA"} or (
        source_mode == "P" and "transparency" in image.info
    )
    prepared = image if keeps_alpha else image.convert("RGB")

    if suffix == ".webp":
        prepared.save(destination, format="WEBP", quality=WEBP_QUALITY, method=6)
        return

    prepared.save(destination, format="PNG", optimize=True)
