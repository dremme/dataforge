from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pydantic import ValidationError

import edit_sidecars
import image_edit
import schemas
from schemas import EditCropRect, ImageEditSpec, MaskRegion
from testing_fixtures import TempMediaFolder, write_image, write_jpeg

RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
YELLOW = (255, 255, 0)

WIDTH = 40
HEIGHT = 20


def corner_marked(width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    """Four identifiable corner pixels. Not square: a rotation that kept the frame shape would still pass on a square."""
    image = Image.new("RGB", (width, height), (10, 10, 10))
    image.putpixel((0, 0), RED)
    image.putpixel((width - 1, 0), GREEN)
    image.putpixel((width - 1, height - 1), BLUE)
    image.putpixel((0, height - 1), YELLOW)
    return image


def graded(width: int = WIDTH, height: int = HEIGHT) -> Image.Image:
    """Every pixel differs from its neighbours, so a blur or a mosaic flattens something visible."""
    image = Image.new("RGB", (width, height))
    for x in range(width):
        for y in range(height):
            image.putpixel((x, y), (x * 6 % 256, y * 12 % 256, (x + y) * 3 % 256))
    return image


def columns(image: Image.Image, row: int = 0) -> list[tuple[int, int, int]]:
    pixels = image.convert("RGB")
    return [pixels.getpixel((x, row)) for x in range(image.width)]


def corners(image: Image.Image) -> tuple[tuple[int, int, int], ...]:
    """Top-left, top-right, bottom-right, bottom-left - clockwise from the top-left."""
    width, height = image.size
    pixels = image.convert("RGB")
    return (
        pixels.getpixel((0, 0)),
        pixels.getpixel((width - 1, 0)),
        pixels.getpixel((width - 1, height - 1)),
        pixels.getpixel((0, height - 1)),
    )


class RenderRotationTests(unittest.TestCase):
    def test_no_rotation_leaves_every_corner_where_it_was(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec())

        self.assertEqual(result.size, (WIDTH, HEIGHT))
        self.assertEqual(corners(result), (RED, GREEN, BLUE, YELLOW))

    def test_ninety_degrees_turns_clockwise_and_swaps_the_frame(self) -> None:
        """Pillow's ROTATE_90 turns the other way; the spec means what the arrow shows."""
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(rotate=90))

        self.assertEqual(result.size, (HEIGHT, WIDTH))
        # The top-left corner swings round to the top-right.
        self.assertEqual(corners(result), (YELLOW, RED, GREEN, BLUE))

    def test_a_hundred_and_eighty_degrees_keeps_the_frame_and_opposes_every_corner(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(rotate=180))

        self.assertEqual(result.size, (WIDTH, HEIGHT))
        self.assertEqual(corners(result), (BLUE, YELLOW, RED, GREEN))

    def test_two_hundred_and_seventy_degrees_is_the_other_quarter_turn(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(rotate=270))

        self.assertEqual(result.size, (HEIGHT, WIDTH))
        self.assertEqual(corners(result), (GREEN, BLUE, YELLOW, RED))

    def test_four_quarter_turns_come_back_to_the_start(self) -> None:
        image = corner_marked()
        for _ in range(4):
            image = image_edit.render_image_edit(image, ImageEditSpec(rotate=90))

        self.assertEqual(image.size, (WIDTH, HEIGHT))
        self.assertEqual(corners(image), (RED, GREEN, BLUE, YELLOW))


class RenderMirrorTests(unittest.TestCase):
    def test_mirroring_horizontally_swaps_left_for_right(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(mirror_h=True))

        self.assertEqual(result.size, (WIDTH, HEIGHT))
        self.assertEqual(corners(result), (GREEN, RED, YELLOW, BLUE))

    def test_mirroring_vertically_swaps_top_for_bottom(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(mirror_v=True))

        self.assertEqual(result.size, (WIDTH, HEIGHT))
        self.assertEqual(corners(result), (YELLOW, BLUE, GREEN, RED))

    def test_both_mirrors_together_are_a_half_turn(self) -> None:
        both = image_edit.render_image_edit(
            corner_marked(), ImageEditSpec(mirror_h=True, mirror_v=True)
        )
        turned = image_edit.render_image_edit(corner_marked(), ImageEditSpec(rotate=180))

        self.assertEqual(corners(both), corners(turned))


class RenderCropTests(unittest.TestCase):
    def test_a_crop_keeps_only_the_region_it_names(self) -> None:
        result = image_edit.render_image_edit(
            corner_marked(),
            ImageEditSpec(crop=EditCropRect(x=0.5, y=0.0, width=0.5, height=0.5)),
        )

        self.assertEqual(result.size, (WIDTH // 2, HEIGHT // 2))
        # Only the top-right marker survives that quadrant.
        self.assertEqual(corners(result)[1], GREEN)
        self.assertNotIn(RED, corners(result))

    def test_a_crop_reaching_the_edge_in_fractions_reaches_it_in_pixels(self) -> None:
        box = image_edit.crop_box(
            (WIDTH, HEIGHT), EditCropRect(x=0.5, y=0.5, width=0.5, height=0.5)
        )

        self.assertEqual(box, (WIDTH // 2, HEIGHT // 2, WIDTH, HEIGHT))

    def test_a_crop_rounds_rather_than_truncating(self) -> None:
        """Video truncates to even for yuv420p; a still has no chroma plane to keep in step."""
        box = image_edit.crop_box((99, 99), EditCropRect(x=0.0, y=0.0, width=0.5, height=0.5))

        self.assertEqual(box, (0, 0, 50, 50))

    def test_a_crop_validated_to_within_an_epsilon_never_asks_for_a_row_that_is_not_there(
        self,
    ) -> None:
        box = image_edit.crop_box(
            (WIDTH, HEIGHT), EditCropRect(x=0.999999, y=0.999999, width=0.5, height=0.5)
        )
        left, top, right, bottom = box

        self.assertLess(left, right)
        self.assertLess(top, bottom)
        self.assertLessEqual(right, WIDTH)
        self.assertLessEqual(bottom, HEIGHT)


class RenderScaleTests(unittest.TestCase):
    def test_scaling_halves_both_axes(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(scale=0.5))

        self.assertEqual(result.size, (WIDTH // 2, HEIGHT // 2))

    def test_a_scale_of_one_leaves_the_size_alone(self) -> None:
        result = image_edit.render_image_edit(corner_marked(), ImageEditSpec(scale=1.0))

        self.assertEqual(result.size, (WIDTH, HEIGHT))

    def test_a_tiny_scale_still_leaves_a_pixel_on_each_axis(self) -> None:
        self.assertEqual(image_edit.scaled_size((8, 4), 0.05), (1, 1))


class RenderMaskTests(unittest.TestCase):
    def test_a_blur_changes_only_the_pixels_inside_the_region(self) -> None:
        source = graded()

        result = image_edit.render_image_edit(
            source,
            ImageEditSpec(masks=[MaskRegion(x=0.0, y=0.0, width=0.5, height=1.0)]),
        )

        self.assertNotEqual(columns(result)[:20], columns(source)[:20])
        self.assertEqual(columns(result)[20:], columns(source)[20:])

    def test_pixelating_leaves_flat_blocks_of_the_size_the_strength_asks_for(self) -> None:
        result = image_edit.render_image_edit(
            graded(),
            ImageEditSpec(
                masks=[
                    MaskRegion(x=0.0, y=0.0, width=1.0, height=1.0, mode="pixelate", strength=0.25)
                ]
            ),
        )

        # A quarter of the 20px height is a 5px block, so five columns share one value.
        self.assertEqual(len(set(columns(result)[:5])), 1)
        self.assertNotEqual(columns(result)[4], columns(result)[5])

    def test_a_blur_leaves_no_flat_blocks(self) -> None:
        result = image_edit.render_image_edit(
            graded(),
            ImageEditSpec(masks=[MaskRegion(x=0.0, y=0.0, width=1.0, height=1.0, strength=0.25)]),
        )

        self.assertNotEqual(columns(result)[0], columns(result)[1])

    def test_a_region_outside_the_crop_is_cropped_away(self) -> None:
        left_half = EditCropRect(x=0.0, y=0.0, width=0.5, height=1.0)
        right_half = MaskRegion(x=0.5, y=0.0, width=0.5, height=1.0)

        masked = image_edit.render_image_edit(
            graded(), ImageEditSpec(masks=[right_half], crop=left_half)
        )
        plain = image_edit.render_image_edit(graded(), ImageEditSpec(crop=left_half))

        self.assertEqual(masked.tobytes(), plain.tobytes())

    def test_the_region_is_measured_against_the_source_and_not_the_crop(self) -> None:
        """Read against the cropped frame the same fractions would leave the crop's left half sharp."""
        spec = ImageEditSpec(
            masks=[MaskRegion(x=0.5, y=0.0, width=0.5, height=1.0, mode="pixelate", strength=0.5)],
            crop=EditCropRect(x=0.5, y=0.0, width=0.5, height=1.0),
        )

        result = image_edit.render_image_edit(graded(), spec)

        self.assertEqual(len(set(columns(result)[:10])), 1)

    def test_every_region_in_the_list_is_applied(self) -> None:
        source = graded()

        result = image_edit.render_image_edit(
            source,
            ImageEditSpec(
                masks=[
                    MaskRegion(x=0.0, y=0.0, width=0.25, height=1.0),
                    MaskRegion(x=0.75, y=0.0, width=0.25, height=1.0),
                ]
            ),
        )

        self.assertNotEqual(columns(result)[:10], columns(source)[:10])
        self.assertEqual(columns(result)[10:30], columns(source)[10:30])
        self.assertNotEqual(columns(result)[30:], columns(source)[30:])

    def test_a_region_smaller_than_one_blur_radius_still_renders(self) -> None:
        result = image_edit.render_image_edit(
            graded(),
            ImageEditSpec(masks=[MaskRegion(x=0.0, y=0.0, width=0.05, height=0.05, strength=0.02)]),
        )

        self.assertEqual(result.size, (WIDTH, HEIGHT))

    def test_the_loaded_original_is_left_alone_for_the_next_render(self) -> None:
        source = graded()
        before = source.tobytes()

        image_edit.render_image_edit(
            source,
            ImageEditSpec(masks=[MaskRegion(x=0.0, y=0.0, width=1.0, height=1.0)]),
        )

        self.assertEqual(source.tobytes(), before)


class MaskSpecTests(unittest.TestCase):
    def test_a_full_frame_region_stands_where_a_full_frame_crop_would_be_dropped(self) -> None:
        spec = ImageEditSpec(masks=[MaskRegion(x=0.0, y=0.0, width=1.0, height=1.0)])

        self.assertEqual(len(spec.masks), 1)

    def test_a_region_reaching_past_an_edge_is_refused(self) -> None:
        for region in (
            MaskRegion(x=0.6, y=0.0, width=0.5, height=0.5),
            MaskRegion(x=0.0, y=0.6, width=0.5, height=0.5),
        ):
            with self.subTest(region=region), self.assertRaises(ValidationError):
                ImageEditSpec(masks=[region])

    def test_more_regions_than_the_cap_are_refused(self) -> None:
        region = MaskRegion(x=0.0, y=0.0, width=0.1, height=0.1)

        with self.assertRaises(ValidationError):
            ImageEditSpec(masks=[region] * (schemas.MAX_MASK_REGIONS + 1))

    def test_a_strength_outside_the_range_is_refused(self) -> None:
        for strength in (0.0, 1.0):
            with self.subTest(strength=strength), self.assertRaises(ValidationError):
                MaskRegion(x=0.0, y=0.0, width=0.5, height=0.5, strength=strength)

    def test_a_mode_that_is_not_a_known_one_is_refused(self) -> None:
        with self.assertRaises(ValidationError):
            MaskRegion(x=0.0, y=0.0, width=0.5, height=0.5, mode="swirl")


class RenderOrderTests(unittest.TestCase):
    def test_crop_then_mirror_then_rotate_then_scale(self) -> None:
        """The one test that pins the order down; each step alone would pass under others."""
        spec = ImageEditSpec(
            crop=EditCropRect(x=0.0, y=0.0, width=0.5, height=1.0),
            mirror_h=True,
            rotate=90,
            scale=0.5,
        )

        result = image_edit.render_image_edit(corner_marked(), spec)

        # Crop keeps the left half, the mirror swaps columns, the quarter turn swaps axes, then scale.
        self.assertEqual(result.size, (HEIGHT // 2, WIDTH // 4))

    def test_the_crop_is_measured_before_the_rotation(self) -> None:
        """A crop expressed against the rotated frame would keep the other half."""
        left_half = EditCropRect(x=0.0, y=0.0, width=0.5, height=1.0)

        result = image_edit.render_image_edit(
            corner_marked(), ImageEditSpec(crop=left_half, rotate=180)
        )

        # The left half holds the red and yellow markers; a half turn keeps both.
        self.assertIn(RED, corners(result))
        self.assertIn(YELLOW, corners(result))
        self.assertNotIn(GREEN, corners(result))


class IdentitySpecTests(unittest.TestCase):
    def test_an_untouched_spec_would_change_nothing(self) -> None:
        self.assertTrue(image_edit.is_identity_spec(ImageEditSpec()))

    def test_a_full_frame_crop_is_normalized_away_and_still_counts_as_nothing(self) -> None:
        spec = ImageEditSpec(crop=EditCropRect(x=0.0, y=0.0, width=1.0, height=1.0))

        self.assertIsNone(spec.crop)
        self.assertTrue(image_edit.is_identity_spec(spec))

    def test_each_field_on_its_own_is_a_real_edit(self) -> None:
        for spec in (
            ImageEditSpec(masks=[MaskRegion(x=0.1, y=0.1, width=0.8, height=0.8)]),
            ImageEditSpec(crop=EditCropRect(x=0.1, y=0.1, width=0.8, height=0.8)),
            ImageEditSpec(mirror_h=True),
            ImageEditSpec(mirror_v=True),
            ImageEditSpec(rotate=90),
            ImageEditSpec(scale=0.5),
        ):
            with self.subTest(spec=spec):
                self.assertFalse(image_edit.is_identity_spec(spec))


class ApplyImageEditTests(unittest.TestCase):
    def test_the_first_edit_stores_the_original_and_writes_the_result(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=WIDTH, height=HEIGHT)
            original = media.read_bytes()

            result = image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            self.assertEqual(edit_sidecars.backup_path_for(media).read_bytes(), original)
            self.assertTrue(result.has_backup)
            with Image.open(media) as written:
                self.assertEqual(written.size, (HEIGHT, WIDTH))
            self.assertEqual(result.width, HEIGHT)
            self.assertEqual(result.height, WIDTH)

    def test_every_render_reads_the_original_rather_than_the_last_result(self) -> None:
        """Two quarter turns applied one after the other leave the file at 90, not 180."""
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=WIDTH, height=HEIGHT)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))
            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            with Image.open(media) as written:
                self.assertEqual(written.size, (HEIGHT, WIDTH))

    def test_the_spec_survives_for_the_next_time_the_editor_opens(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            spec = ImageEditSpec(rotate=180, mirror_v=True, scale=0.5)

            image_edit.apply_image_edit(media, spec)

            self.assertEqual(image_edit.read_image_edit_spec(media), spec)

    def test_a_failed_write_leaves_the_file_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            original = media.read_bytes()

            with patch("image_edit.save_image_preserving_format", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob("*.edit-tmp")), [])
            self.assertIsNone(image_edit.read_image_edit_spec(media))

    def test_a_failed_write_keeps_the_backup_it_just_made(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            with patch("image_edit.save_image_preserving_format", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            self.assertTrue(edit_sidecars.backup_path_for(media).is_file())

    def test_leftovers_from_a_hard_kill_are_swept_first(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")
            (root / "other.png.edit-tmp").write_bytes(b"junk")
            (root / "other.png.edit-stale").write_bytes(b"junk")

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            self.assertEqual(list(root.glob("*.edit-tmp")), [])
            self.assertEqual(list(root.glob("*.edit-stale")), [])

    def test_a_format_that_cannot_be_edited_is_refused_before_anything_is_copied(self) -> None:
        with TempMediaFolder() as root:
            media = root / "loop.gif"
            media.write_bytes(b"GIF89a")

            with self.assertRaises(ValueError):
                image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            self.assertFalse(edit_sidecars.backup_path_for(media).exists())


class FormatPreservationTests(unittest.TestCase):
    def test_each_format_is_written_back_as_itself(self) -> None:
        """The temp file carries no media suffix, so the format has to be named, not sniffed."""
        for name, expected in (
            ("photo.png", "PNG"),
            ("photo.jpg", "JPEG"),
            ("photo.jpeg", "JPEG"),
            ("photo.webp", "WEBP"),
            ("photo.bmp", "BMP"),
        ):
            with self.subTest(name=name):
                with TempMediaFolder() as root:
                    media = write_image(root, name, width=WIDTH, height=HEIGHT)

                    image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

                    with Image.open(media) as written:
                        self.assertEqual(written.format, expected)
                        self.assertEqual(written.size, (HEIGHT, WIDTH))

    def test_transparency_survives_a_rotation(self) -> None:
        with TempMediaFolder() as root:
            media = root / "sprite.png"
            Image.new("RGBA", (WIDTH, HEIGHT), (255, 0, 0, 0)).save(media)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            with Image.open(media) as written:
                self.assertIn("A", written.getbands())
                self.assertEqual(written.convert("RGBA").getpixel((0, 0))[3], 0)

    def test_a_paletted_png_keeps_its_transparency(self) -> None:
        with TempMediaFolder() as root:
            media = root / "sprite.png"
            indexed = Image.new("P", (WIDTH, HEIGHT), 0)
            indexed.putpalette([255, 0, 0] + [0] * 765)
            indexed.save(media, transparency=0)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            with Image.open(media) as written:
                self.assertIn("A", written.getbands())
                self.assertEqual(written.convert("RGBA").getpixel((0, 0))[3], 0)

    def test_an_opaque_source_is_not_given_an_alpha_channel_it_never_had(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=WIDTH, height=HEIGHT)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            with Image.open(media) as written:
                self.assertNotIn("A", written.getbands())


class ExifOrientationTests(unittest.TestCase):
    def test_a_rotated_camera_file_is_edited_as_the_viewer_sees_it(self) -> None:
        """Orientation 6 means "turn a quarter clockwise to display", so 64x48 shows as 48x64."""
        with TempMediaFolder() as root:
            media = write_jpeg(root, "photo.jpg", width=64, height=48, orientation=6)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            # Displayed 48x64, turned another quarter, lands at 64x48, not 48x64.
            with Image.open(media) as written:
                self.assertEqual(written.size, (64, 48))

    def test_the_orientation_tag_is_dropped_so_the_result_is_not_turned_twice(self) -> None:
        with TempMediaFolder() as root:
            media = write_jpeg(root, "photo.jpg", width=64, height=48, orientation=6)

            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            with Image.open(media) as written:
                self.assertNotIn(0x0112, written.getexif())


class RevertImageEditTests(unittest.TestCase):
    def test_reverting_restores_the_original_bytes_and_clears_the_spec(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png", width=WIDTH, height=HEIGHT)
            original = media.read_bytes()
            image_edit.apply_image_edit(media, ImageEditSpec(rotate=90))

            result = image_edit.revert_image_edit(media)

            self.assertEqual(media.read_bytes(), original)
            self.assertFalse(result.has_backup)
            self.assertFalse(edit_sidecars.backup_path_for(media).exists())
            self.assertIsNone(image_edit.read_image_edit_spec(media))

    def test_reverting_without_a_backup_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.png")

            with self.assertRaises(ValueError):
                image_edit.revert_image_edit(media)


class ResolveImageFormatTests(unittest.TestCase):
    def test_every_editable_suffix_resolves(self) -> None:
        for suffix in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
            with self.subTest(suffix=suffix):
                self.assertEqual(image_edit.resolve_image_format(Path(f"photo{suffix}")), suffix)

    def test_a_suffix_is_matched_case_insensitively(self) -> None:
        self.assertEqual(image_edit.resolve_image_format(Path("PHOTO.JPG")), ".jpg")

    def test_a_gif_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            image_edit.resolve_image_format(Path("loop.gif"))


if __name__ == "__main__":
    unittest.main()
