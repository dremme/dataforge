"""Unit tests for the watermark job."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import automation.watermark as watermark_module
from automation.watermark import (
    FONT_MISSING_MESSAGE,
    MAX_WATERMARK_TEXT_LENGTH,
    WATERMARK_SIZES,
    WATERMARK_STALE_MARKER,
    WATERMARK_TEMP_MARKER,
    WatermarkCancelled,
    build_drawtext_filter,
    escape_drawtext_path,
    escape_drawtext_text,
    list_watermark_files,
    normalize_watermark_text,
    resolve_watermark_alpha,
    resolve_watermark_position,
    resolve_watermark_size,
    run_watermark_job,
    validate_watermark_folder,
)
from constants import WATERMARK_DIR_NAME
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_image,
    write_jpeg,
    write_media,
    write_mp4_video,
)

SAMPLE_FONT = Path(r"C:\Windows\Fonts\segoeui.ttf")


def watermarked(root: Path, name: str) -> Path:
    return root / WATERMARK_DIR_NAME / name


def bottom_right(image: Image.Image) -> Image.Image:
    width, height = image.size
    return image.crop((width // 2, height // 2, width, height))


def top_left(image: Image.Image) -> Image.Image:
    width, height = image.size
    return image.crop((0, 0, width // 2, height // 2))


class DrawtextEscapingTests(unittest.TestCase):
    def test_escapes_windows_font_path(self) -> None:
        self.assertEqual(
            escape_drawtext_path(SAMPLE_FONT),
            "C\\:/Windows/Fonts/segoeui.ttf",
        )

    def test_escapes_filtergraph_metacharacters(self) -> None:
        cases = {
            "ab": "ab",
            "a:b": "a\\:b",
            "it's mine": "it\\'s mine",
            "100% sure": "100\\% sure",
            "a\\b": "a\\\\b",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(escape_drawtext_text(text), expected)

    def test_escapes_backslash_before_the_escapes_it_adds(self) -> None:
        # Escaping ':' first would leave 'a\\\:b', which renders a stray backslash.
        self.assertEqual(escape_drawtext_text("a:b"), "a\\:b")
        self.assertEqual(escape_drawtext_text("a\\:b"), "a\\\\\\:b")

    def test_leaves_braces_and_commas_alone(self) -> None:
        self.assertEqual(escape_drawtext_text("x{y}z, w[q]"), "x{y}z, w[q]")


class DrawtextFilterTests(unittest.TestCase):
    def filter_for(
        self,
        size: str = "medium",
        alpha: float = 0.5,
        text: str = "Sample",
        position: str = "bottom",
    ) -> str:
        return build_drawtext_filter(
            text=text,
            font_path=SAMPLE_FONT,
            size=WATERMARK_SIZES[size],
            alpha=alpha,
            position=position,  # type: ignore[arg-type]
        )

    def test_builds_the_expected_filter(self) -> None:
        self.assertEqual(
            self.filter_for(),
            "drawtext=fontfile='C\\:/Windows/Fonts/segoeui.ttf'"
            ":text='Sample'"
            ":expansion=none"
            ":fontsize=max(12\\,h*0.045)"
            ":fontcolor=white@0.50"
            ":borderw=2:bordercolor=black@0.35"
            ":x=w-tw-(max(8\\,h*0.02))"
            ":y=h-th-(max(8\\,h*0.02))",
        )

    def test_positions_map_to_the_matching_x_y_expressions(self) -> None:
        cases = {
            "top": (":x=max(8\\,h*0.02)", ":y=max(8\\,h*0.02)"),
            "center": (":x=(w-tw)/2", ":y=(h-th)/2"),
            "bottom": (":x=w-tw-(max(8\\,h*0.02))", ":y=h-th-(max(8\\,h*0.02))"),
        }
        for position, (x_fragment, y_fragment) in cases.items():
            with self.subTest(position=position):
                filter_text = self.filter_for(position=position)
                self.assertIn(x_fragment, filter_text)
                self.assertIn(y_fragment, filter_text)

    def test_disables_strftime_expansion(self) -> None:
        # Without this a '%' in the text is read as a strftime directive.
        self.assertIn(":expansion=none", self.filter_for(text="100%"))

    def test_escapes_every_comma_inside_an_expression(self) -> None:
        # A bare comma ends the filter's option list, so none may survive unescaped.
        for fragment in self.filter_for().split(":"):
            if "max(" in fragment:
                self.assertNotIn(",", fragment.replace("\\,", ""), fragment)

    def test_border_width_is_a_plain_integer(self) -> None:
        # ffmpeg's borderw rejects frame variables, unlike fontsize/x/y.
        self.assertIn(":borderw=3:", self.filter_for(size="large"))

    def test_draws_on_every_frame(self) -> None:
        self.assertNotIn("enable=", self.filter_for())

    def test_size_table_grows_with_each_step(self) -> None:
        scales = [WATERMARK_SIZES[name].font_scale for name in ("small", "medium", "large")]
        self.assertEqual(scales, sorted(scales))
        self.assertTrue(all(WATERMARK_SIZES[name].stroke_px >= 1 for name in WATERMARK_SIZES))


class WatermarkValidationTests(unittest.TestCase):
    def test_lists_every_image_and_the_mp4_family(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_jpeg(root, "beach.jpg")
            write_jpeg(root, "beach.jpeg")
            write_image(root, "logo.webp")
            write_image(root, "logo.bmp")
            write_mp4_video(root, "clip.mp4")
            write_mp4_video(root, "clip.mov")
            write_mp4_video(root, "clip.m4v")
            write_gif(root, "loop.gif")
            (root / "notes.txt").write_text("ignore", encoding="utf-8")

            names = {path.name for path in list_watermark_files(root)}

            self.assertEqual(
                names,
                {
                    "photo.png",
                    "beach.jpg",
                    "beach.jpeg",
                    "logo.webp",
                    "logo.bmp",
                    "clip.mp4",
                    "clip.mov",
                    "clip.m4v",
                },
            )

    def test_skips_containers_the_ffmpeg_command_cannot_mux(self) -> None:
        """`-movflags` and `-c:a copy` are MP4-family shaped; the rest are left alone."""
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            for name in ("clip.mkv", "clip.avi", "clip.wmv", "clip.flv"):
                write_mp4_video(root, name)

            names = {path.name for path in list_watermark_files(root)}

            self.assertEqual(names, {"photo.png"})

    def test_rejects_empty_text(self) -> None:
        for text in ("", "   "):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "cannot be empty"):
                normalize_watermark_text(text)

    def test_rejects_text_over_the_length_cap(self) -> None:
        with self.assertRaisesRegex(ValueError, "longer than 120"):
            normalize_watermark_text("x" * (MAX_WATERMARK_TEXT_LENGTH + 1))

    def test_rejects_line_breaks(self) -> None:
        with self.assertRaisesRegex(ValueError, "line breaks"):
            normalize_watermark_text("line\nbreak")

    def test_accepts_filtergraph_metacharacters(self) -> None:
        # These are escaped at render time; rejecting them would be a regression.
        self.assertEqual(normalize_watermark_text("  a:b's 100% \\  "), "a:b's 100% \\")

    def test_rejects_unknown_size_opacity_and_position(self) -> None:
        with self.assertRaisesRegex(ValueError, "size must be one of"):
            resolve_watermark_size("huge")
        with self.assertRaisesRegex(ValueError, "opacity must be one of"):
            resolve_watermark_alpha(33)
        with self.assertRaisesRegex(ValueError, "position must be one of"):
            resolve_watermark_position("side")

    def test_resolves_opacity_to_an_alpha_fraction(self) -> None:
        self.assertEqual(resolve_watermark_alpha(75), 0.75)

    def test_resolves_known_positions(self) -> None:
        for position in ("top", "center", "bottom"):
            with self.subTest(position=position):
                self.assertEqual(resolve_watermark_position(position), position)

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_gif(root, "loop.gif")

            with self.assertRaisesRegex(ValueError, "No JPG, PNG, WebP, BMP, MP4, MOV or M4V"):
                validate_watermark_folder(root, text="Sample")

    def test_refuses_to_run_inside_the_output_folder(self) -> None:
        with TempMediaFolder() as root:
            nested = root / WATERMARK_DIR_NAME
            nested.mkdir()
            write_media(nested, "photo.png")

            with self.assertRaisesRegex(ValueError, "Open the parent folder"):
                validate_watermark_folder(nested, text="Sample")

    def test_refuses_when_the_output_name_is_taken_by_a_file(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            (root / WATERMARK_DIR_NAME).write_text("not a folder", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "a file with that name already exists"):
                validate_watermark_folder(root, text="Sample")

    def test_reports_a_missing_font_before_the_job_starts(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with patch("automation.watermark.resolve_watermark_font", return_value=None):
                with self.assertRaisesRegex(ValueError, "No usable system font"):
                    validate_watermark_folder(root, text="Sample")

            self.assertIn("No usable system font", FONT_MISSING_MESSAGE)


class WatermarkImageTests(unittest.TestCase):
    def test_marks_the_bottom_right_and_leaves_the_original_alone(self) -> None:
        with TempMediaFolder() as root:
            source = write_media(root, "photo.png", width=400, height=300)
            before = source.read_bytes()

            result = run_watermark_job(root, text="Sample Studio")

            self.assertEqual(result["processed"], 1)
            self.assertEqual(source.read_bytes(), before)

            with Image.open(watermarked(root, "photo.png")) as output:
                self.assertEqual(output.size, (400, 300))
                self.assertIsNotNone(bottom_right(output).convert("L").getbbox())
                self.assertIsNone(top_left(output).convert("L").getbbox())

    def test_releases_the_source_file_handle(self) -> None:
        with TempMediaFolder() as root:
            source = write_media(root, "photo.png", width=200, height=150)

            run_watermark_job(root, text="Sample Studio")

            # Windows refuses both of these while Pillow still holds the file open.
            source.rename(root / "renamed.png")
            (root / "renamed.png").unlink()

    def test_jpeg_stays_a_jpeg(self) -> None:
        with TempMediaFolder() as root:
            write_jpeg(root, "beach.jpg", width=320, height=240)

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "beach.jpg")) as output:
                self.assertEqual(output.format, "JPEG")
                self.assertEqual(output.mode, "RGB")

    def test_every_image_format_is_saved_as_itself(self) -> None:
        """The output is named after the source, so it has to be encoded that way too."""
        expected = {
            "beach.jpg": "JPEG",
            "photo.png": "PNG",
            "logo.webp": "WEBP",
            "logo.bmp": "BMP",
        }

        for name, image_format in expected.items():
            with self.subTest(name=name), TempMediaFolder() as root:
                if name.endswith(".jpg"):
                    write_jpeg(root, name, width=320, height=240)
                elif name.endswith(".png"):
                    write_media(root, name, width=320, height=240)
                else:
                    write_image(root, name, width=320, height=240)

                run_watermark_job(root, text="Sample Studio")

                with Image.open(watermarked(root, name)) as output:
                    self.assertEqual(output.format, image_format)
                    self.assertEqual(output.size, (320, 240))
                    self.assertIsNotNone(bottom_right(output).convert("L").getbbox())

    def test_transparent_webp_keeps_its_alpha_channel(self) -> None:
        with TempMediaFolder() as root:
            Image.new("RGBA", (200, 150), (0, 0, 0, 0)).save(root / "logo.webp")

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "logo.webp")) as output:
                self.assertEqual(output.format, "WEBP")
                self.assertEqual(output.mode, "RGBA")

    def test_opaque_png_does_not_gain_an_alpha_channel(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=200, height=150)

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "photo.png")) as output:
                self.assertEqual(output.mode, "RGB")

    def test_transparent_png_keeps_its_alpha_channel(self) -> None:
        with TempMediaFolder() as root:
            Image.new("RGBA", (200, 150), (0, 0, 0, 0)).save(root / "logo.png")

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "logo.png")) as output:
                self.assertEqual(output.mode, "RGBA")

    def test_higher_opacity_renders_brighter(self) -> None:
        marks = {}
        for opacity in (25, 75):
            with TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)
                run_watermark_job(root, text="Sample Studio", opacity=opacity)
                with Image.open(watermarked(root, "photo.png")) as output:
                    pixels = list(bottom_right(output).convert("L").getdata())
                    marks[opacity] = sum(pixels) / len(pixels)

        self.assertGreater(marks[75], marks[25])

    def test_larger_size_renders_wider(self) -> None:
        widths = {}
        for size in ("small", "large"):
            with TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)
                run_watermark_job(root, text="Sample Studio", size=size)
                with Image.open(watermarked(root, "photo.png")) as output:
                    box = output.convert("L").getbbox()
                    assert box is not None
                    widths[size] = box[2] - box[0]

        self.assertGreater(widths["large"], widths["small"])

    def test_top_places_the_mark_in_the_top_left(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=400, height=300)

            run_watermark_job(root, text="Sample Studio", position="top")

            with Image.open(watermarked(root, "photo.png")) as output:
                self.assertIsNotNone(top_left(output).convert("L").getbbox())
                self.assertIsNone(bottom_right(output).convert("L").getbbox())

    def test_center_places_the_mark_near_the_middle(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=400, height=300)

            run_watermark_job(root, text="Sample Studio", position="center")

            with Image.open(watermarked(root, "photo.png")) as output:
                box = output.convert("L").getbbox()
                assert box is not None
                center_x = (box[0] + box[2]) / 2
                center_y = (box[1] + box[3]) / 2
                self.assertAlmostEqual(center_x, 200, delta=40)
                self.assertAlmostEqual(center_y, 150, delta=40)

    def test_rotated_jpeg_is_marked_in_the_corner_the_viewer_sees(self) -> None:
        with TempMediaFolder() as root:
            # Orientation 6 means "rotate 90 degrees clockwise to display".
            write_jpeg(root, "portrait.jpg", width=400, height=300, orientation=6)

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "portrait.jpg")) as output:
                self.assertEqual(output.size, (300, 400))
                self.assertIsNotNone(bottom_right(output).convert("L").getbbox())
                self.assertIsNone(top_left(output).convert("L").getbbox())

    def test_reports_a_source_that_cannot_be_decoded(self) -> None:
        with TempMediaFolder() as root:
            (root / "broken.png").write_bytes(b"not a png")

            result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["read_error"], 1)
            self.assertEqual(stats["success"], 0)
            results = result["results"]
            assert isinstance(results, list)
            self.assertEqual(results[0]["status"], "read_error")


class WatermarkVideoTests(unittest.TestCase):
    """The video path is mocked: no backend test invokes ffmpeg for real."""

    def test_counts_images_and_videos_separately(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_mp4_video(root, "clip.mp4")

            with patch("automation.watermark.watermark_video") as encode:
                encode.side_effect = lambda source, destination, **_: destination.write_bytes(b"x")
                result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["success"], 2)
            self.assertEqual(stats["image_success"], 1)
            self.assertEqual(stats["video_success"], 1)
            self.assertEqual(result["processed"], 2)
            self.assertTrue(watermarked(root, "clip.mp4").exists())

    def test_reports_missing_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4")

            with patch("automation.watermark.ffmpeg_path", return_value=None):
                result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["ffmpeg_error"], 1)
            results = result["results"]
            assert isinstance(results, list)
            self.assertEqual(results[0]["status"], "ffmpeg_error")

    def test_reports_an_ffmpeg_failure(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4")

            with patch("automation.watermark.watermark_video", side_effect=RuntimeError("boom")):
                result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["ffmpeg_error"], 1)
            self.assertFalse(watermarked(root, "clip.mp4").exists())

    def test_cancelling_mid_encode_accounts_for_every_remaining_file(self) -> None:
        with TempMediaFolder() as root:
            for index in range(4):
                write_mp4_video(root, f"clip_{index}.mp4")

            calls = {"count": 0}

            def encode(source: Path, destination: Path, **_: object) -> None:
                calls["count"] += 1
                if calls["count"] == 2:
                    destination.write_bytes(b"partial")
                    raise WatermarkCancelled
                destination.write_bytes(b"x")

            with patch("automation.watermark.watermark_video", side_effect=encode):
                result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["cancelled"], 3)
            self.assertEqual(stats["video_success"], 1)
            results = result["results"]
            assert isinstance(results, list)
            self.assertEqual(len(results), 2)
            self.assertEqual(results[1]["status"], "cancelled")

            leftovers = list((root / WATERMARK_DIR_NAME).glob(f"*{WATERMARK_TEMP_MARKER}.*"))
            self.assertEqual(leftovers, [])


class WatermarkOutputFolderTests(unittest.TestCase):
    def test_rerunning_replaces_the_previous_output(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=400, height=300)

            run_watermark_job(root, text="Sample Studio", size="small")
            small = watermarked(root, "photo.png").read_bytes()

            run_watermark_job(root, text="Sample Studio", size="large")
            large = watermarked(root, "photo.png").read_bytes()

            self.assertNotEqual(small, large)
            self.assertEqual(
                sorted(path.name for path in (root / WATERMARK_DIR_NAME).iterdir()),
                ["photo.png"],
            )

    def test_sweeps_temp_files_left_by_an_interrupted_run(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            output_dir = root / WATERMARK_DIR_NAME
            output_dir.mkdir()
            stale = output_dir / f"other{WATERMARK_TEMP_MARKER}.png"
            stale.write_bytes(b"interrupted")
            displaced = output_dir / f"prior{WATERMARK_STALE_MARKER}.png"
            displaced.write_bytes(b"displaced")

            run_watermark_job(root, text="Sample Studio")

            self.assertFalse(stale.exists())
            self.assertFalse(displaced.exists())

    def test_a_write_failure_keeps_the_files_that_succeeded(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "a_photo.png")
            write_media(root, "b_photo.png")

            real_save = watermark_module.save_image_preserving_format

            def save(merged: Image.Image, destination: Path, **kwargs: object) -> None:
                if destination.name.startswith("b_photo"):
                    raise OSError("disk full")
                real_save(merged, destination, **kwargs)  # type: ignore[arg-type]

            with patch.object(watermark_module, "save_image_preserving_format", side_effect=save):
                result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["write_error"], 1)
            self.assertEqual(stats["success"], 1)
            self.assertEqual(
                sorted(path.name for path in (root / WATERMARK_DIR_NAME).iterdir()),
                ["a_photo.png"],
            )

    def test_selection_limits_the_output(self) -> None:
        with TempMediaFolder() as root:
            first = write_media(root, "a_photo.png")
            write_media(root, "b_photo.png")

            run_watermark_job(root, text="Sample Studio", selected_paths=[first])

            self.assertEqual(
                sorted(path.name for path in (root / WATERMARK_DIR_NAME).iterdir()),
                ["a_photo.png"],
            )


if __name__ == "__main__":
    unittest.main()
