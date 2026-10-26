from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageChops, ImageDraw

import automation.watermark as watermark_module
from automation.watermark import (
    FONT_MISSING_MESSAGE,
    IMAGE_MISSING_MESSAGE,
    MAX_WATERMARK_TEXT_LENGTH,
    NO_MARK_MESSAGE,
    WATERMARK_SIZES,
    WATERMARK_STALE_MARKER,
    WATERMARK_TEMP_MARKER,
    ImageMark,
    TextMark,
    build_drawtext_filter,
    build_gif_watermark_command,
    build_mark_graph,
    escape_drawtext_path,
    escape_drawtext_text,
    list_watermark_files,
    normalize_watermark_text,
    resolve_watermark_alpha,
    resolve_watermark_position,
    resolve_watermark_size,
    run_watermark_job,
    validate_watermark_folder,
    watermark_image_path,
)
from constants import WATERMARK_DIR_NAME
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_image,
    write_jpeg,
    write_media,
    write_mp4_video,
)

SAMPLE_FONT = Path(r"C:\Windows\Fonts\segoeui.ttf")


def text_mark(
    text: str = "Sample",
    *,
    size: str = "medium",
    alpha: float = 0.5,
    position: str = "bottom_right",
) -> TextMark:
    return TextMark(
        text=text,
        font_path=SAMPLE_FONT,
        size=WATERMARK_SIZES[size],
        alpha=alpha,
        position=resolve_watermark_position(position),
    )


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
        position: str = "bottom_right",
    ) -> str:
        return build_drawtext_filter(text_mark(text, size=size, alpha=alpha, position=position))

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
            "top_left": (":x=max(8\\,h*0.02)", ":y=max(8\\,h*0.02)"),
            "top_right": (":x=w-tw-(max(8\\,h*0.02))", ":y=max(8\\,h*0.02)"),
            "center": (":x=(w-tw)/2", ":y=(h-th)/2"),
            "bottom_left": (":x=max(8\\,h*0.02)", ":y=h-th-(max(8\\,h*0.02))"),
            "bottom_right": (":x=w-tw-(max(8\\,h*0.02))", ":y=h-th-(max(8\\,h*0.02))"),
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
    def test_lists_every_image_gifs_and_the_mp4_family(self) -> None:
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
                    "loop.gif",
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
        for position in ("top_left", "top_right", "center", "bottom_left", "bottom_right"):
            with self.subTest(position=position):
                self.assertEqual(resolve_watermark_position(position), position)

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mkv")

            with self.assertRaisesRegex(ValueError, "No JPG, PNG, WebP, BMP, GIF, MP4, MOV or M4V"):
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
                    pixels = bottom_right(output).convert("L").tobytes()
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

            run_watermark_job(root, text="Sample Studio", position="top_left")

            with Image.open(watermarked(root, "photo.png")) as output:
                self.assertIsNotNone(top_left(output).convert("L").getbbox())
                self.assertIsNone(bottom_right(output).convert("L").getbbox())

    def test_text_takes_the_same_five_positions_as_the_png(self) -> None:
        expected = {
            "top_left": (lambda x: x < 200, lambda y: y < 150),
            "top_right": (lambda x: x > 200, lambda y: y < 150),
            "bottom_left": (lambda x: x < 200, lambda y: y > 150),
            "bottom_right": (lambda x: x > 200, lambda y: y > 150),
        }
        for position, (check_x, check_y) in expected.items():
            with self.subTest(position=position), TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)

                run_watermark_job(root, text="Sample Studio", position=position)

                with Image.open(watermarked(root, "photo.png")) as output:
                    box = output.convert("L").getbbox()
                assert box is not None
                self.assertTrue(check_x((box[0] + box[2]) / 2), (position, box))
                self.assertTrue(check_y((box[1] + box[3]) / 2), (position, box))

    def test_text_can_be_fully_opaque(self) -> None:
        brightest = {}
        for opacity in (75, 100):
            with TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)
                run_watermark_job(root, text="Sample Studio", opacity=opacity)
                with Image.open(watermarked(root, "photo.png")) as output:
                    brightest[opacity] = max(output.convert("L").tobytes())

        self.assertEqual(brightest[100], 255)
        self.assertLess(brightest[75], 255)

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
                    raise FfmpegCancelled
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

    def test_the_command_maps_the_first_video_and_every_audio_track(self) -> None:
        commands: list[list[str]] = []

        with patch(
            "automation.watermark.run_ffmpeg",
            side_effect=lambda command, **_: commands.append(command),
        ):
            watermark_module.watermark_video(
                Path("in.mp4"),
                Path("out.mp4"),
                text=text_mark("Sample Studio"),
                image=None,
                ffmpeg="ffmpeg",
            )

        command = commands[0]
        mapped = [command[i + 1] for i, token in enumerate(command) if token == "-map"]
        # The first video and every audio track: not `-map 0`, which would pull in cover art
        # (drawtext cannot filter two video streams) and untyped subtitle/data streams.
        self.assertEqual(mapped, ["[v]", "0:a?"])
        graph = command[command.index("-filter_complex") + 1]
        self.assertTrue(graph.startswith("[0:v:0]drawtext="), graph)


def write_jpeg_with_exif(root: Path, name: str = "photo.jpg") -> Path:
    """Software and Artist, not Orientation: ``exif_transpose`` drops Orientation on every read."""
    media = root / name
    exif = Image.Exif()
    exif[0x0131] = "DataForge Test"
    exif[0x013B] = "Someone"
    Image.new("RGB", (200, 150), (40, 80, 120)).save(media, format="JPEG", exif=exif)
    return media


class WatermarkStripMetadataTests(unittest.TestCase):
    def test_the_copy_carries_the_original_exif_by_default(self) -> None:
        with TempMediaFolder() as root:
            write_jpeg_with_exif(root)

            run_watermark_job(root, text="Sample Studio")

            with Image.open(watermarked(root, "photo.jpg")) as copy:
                self.assertEqual(copy.getexif().get(0x0131), "DataForge Test")

    def test_the_copy_keeps_the_colour_profile(self) -> None:
        from PIL import ImageCms

        with TempMediaFolder() as root:
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
            for name, fmt in (("photo.jpg", "JPEG"), ("photo.webp", "WEBP")):
                Image.new("RGB", (200, 150), (40, 80, 120)).save(
                    root / name, format=fmt, icc_profile=profile
                )

            run_watermark_job(root, text="Sample Studio")

            # save_image_preserving_format passes icc_profile from encoderinfo; without it Pillow's
            # JPEG and WebP savers drop the profile silently.
            for name in ("photo.jpg", "photo.webp"):
                with Image.open(watermarked(root, name)) as copy:
                    self.assertIsNotNone(copy.info.get("icc_profile"))

    def test_a_cancel_during_the_strip_is_reported_as_cancelled(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with patch.object(watermark_module, "strip_file_metadata", side_effect=FfmpegCancelled):
                result = run_watermark_job(root, text="Sample Studio", strip_metadata=True)

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["cancelled"], 1)
            self.assertEqual(stats["success"], 0)
            leftovers = list((root / WATERMARK_DIR_NAME).glob(f"*{WATERMARK_TEMP_MARKER}.*"))
            self.assertEqual(leftovers, [])

    def test_stripping_removes_the_exif_from_the_copy_only(self) -> None:
        with TempMediaFolder() as root:
            original = write_jpeg_with_exif(root)

            run_watermark_job(root, text="Sample Studio", strip_metadata=True)

            with Image.open(watermarked(root, "photo.jpg")) as copy:
                self.assertEqual(dict(copy.getexif()), {})
            with Image.open(original) as source:
                self.assertEqual(source.getexif().get(0x0131), "DataForge Test")

    def test_strips_the_temp_before_it_is_published(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with patch.object(watermark_module, "strip_file_metadata") as strip:
                run_watermark_job(root, text="Sample Studio", strip_metadata=True)

            stripped = Path(strip.call_args.args[0])
            # Stripping the published copy would leave a marked file carrying metadata if it failed.
            self.assertIn(WATERMARK_TEMP_MARKER, stripped.name)
            self.assertFalse(stripped.exists())

    def test_a_failed_strip_leaves_the_previous_copy_untouched(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            run_watermark_job(root, text="Sample Studio")
            published = watermarked(root, "photo.png").read_bytes()

            with patch.object(
                watermark_module, "strip_file_metadata", side_effect=OSError("disk full")
            ):
                result = run_watermark_job(root, text="Other Studio", strip_metadata=True)

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["write_error"], 1)
            self.assertEqual(stats["success"], 0)
            self.assertEqual(watermarked(root, "photo.png").read_bytes(), published)
            self.assertEqual(
                sorted(path.name for path in (root / WATERMARK_DIR_NAME).iterdir()),
                ["photo.png"],
            )


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
                real_save(merged, destination, **kwargs)

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


def write_flat_gif(
    root: Path,
    name: str,
    *,
    colours: list[tuple[int, int, int]],
    durations: list[int],
    loop: int | None = 0,
    transparent: bool = False,
    comment: str | None = None,
) -> Path:
    """One flat colour per frame; ``transparent`` clears the left half of every frame."""
    frames = []
    for colour in colours:
        frame = Image.new("P", (160, 120), 1)
        frame.putpalette([0, 0, 0, *colour])
        if transparent:
            ImageDraw.Draw(frame).rectangle((0, 0, 79, 119), fill=0)
        frames.append(frame)

    options: dict[str, object] = {}
    if loop is not None:
        options["loop"] = loop
    if transparent:
        options["transparency"] = 0
    if comment is not None:
        options["comment"] = comment

    media = root / name
    frames[0].save(
        media, save_all=True, append_images=frames[1:], duration=durations, disposal=2, **options
    )
    return media


def read_gif(path: Path) -> tuple[list[Image.Image], list[int], dict]:
    """Composited frames, per-frame delays, and the header info of frame zero."""
    with Image.open(path) as opened:
        info = dict(opened.info)
        frames: list[Image.Image] = []
        delays: list[int] = []
        for index in range(opened.n_frames):
            opened.seek(index)
            frames.append(opened.convert("RGBA"))
            delays.append(opened.info["duration"])
    return frames, delays, info


class WatermarkGifTests(unittest.TestCase):
    def test_an_unreadable_gif_is_a_read_error(self) -> None:
        with TempMediaFolder() as root:
            (root / "broken.gif").write_bytes(b"not a gif")

            result = run_watermark_job(root, text="Sample Studio", ffmpeg="ffmpeg")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["read_error"], 1)
            self.assertFalse(watermarked(root, "broken.gif").exists())


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class WatermarkGifEncodeTests(unittest.TestCase):
    """Real encodes: the muxer's delay rounding and palette loss only show in the output."""

    def test_marks_every_frame_and_keeps_the_timing_and_loop_count(self) -> None:
        with TempMediaFolder() as root:
            source = write_flat_gif(
                root,
                "loop.gif",
                colours=[(20, 20, 20), (30, 20, 20), (20, 30, 20)],
                durations=[100, 250, 400],
                loop=3,
            )
            original = source.read_bytes()

            result = run_watermark_job(root, text="Sample Studio")

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["success"], 1)
            self.assertEqual(stats["video_success"], 1)
            self.assertEqual(source.read_bytes(), original)

            frames, delays, info = read_gif(watermarked(root, "loop.gif"))
            self.assertEqual(delays, [100, 250, 400])
            self.assertEqual(info.get("loop"), 3)
            for frame in frames:
                # Frames are near-black and distinct, since Pillow merges identical frames.
                marked = bottom_right(frame).convert("L").point(lambda value: value > 100 and 255)
                self.assertIsNotNone(marked.getbbox())

    def test_a_gif_that_plays_once_still_plays_once(self) -> None:
        with TempMediaFolder() as root:
            write_flat_gif(
                root,
                "once.gif",
                colours=[(20, 20, 20), (40, 40, 40)],
                durations=[100, 100],
                loop=None,
            )

            run_watermark_job(root, text="Sample Studio")

            _, _, info = read_gif(watermarked(root, "once.gif"))
            self.assertNotIn("loop", info)

    def test_keeps_colours_that_only_appear_in_later_frames(self) -> None:
        with TempMediaFolder() as root:
            write_flat_gif(
                root, "flash.gif", colours=[(255, 0, 0), (0, 0, 255)], durations=[100, 100]
            )

            run_watermark_job(root, text="Sample Studio")

            frames, _, _ = read_gif(watermarked(root, "flash.gif"))
            self.assertEqual(
                [frame.getpixel((5, 5)) for frame in frames], [(255, 0, 0, 255), (0, 0, 255, 255)]
            )

    def test_keeps_transparency(self) -> None:
        with TempMediaFolder() as root:
            write_flat_gif(
                root,
                "clear.gif",
                colours=[(255, 0, 0), (0, 0, 255)],
                durations=[100, 100],
                transparent=True,
            )

            run_watermark_job(root, text="Sample Studio")

            frames, _, _ = read_gif(watermarked(root, "clear.gif"))
            self.assertEqual([frame.getpixel((5, 5))[3] for frame in frames], [0, 0])

    def test_stripping_metadata_succeeds_and_the_copy_carries_no_comment(self) -> None:
        with TempMediaFolder() as root:
            write_flat_gif(
                root,
                "tagged.gif",
                colours=[(20, 20, 20), (40, 40, 40)],
                durations=[100, 100],
                comment="Sample Author",
            )

            result = run_watermark_job(root, text="Sample Studio", strip_metadata=True)

            stats = result["stats"]
            assert isinstance(stats, dict)
            self.assertEqual(stats["success"], 1)
            _, _, info = read_gif(watermarked(root, "tagged.gif"))
            self.assertNotIn("comment", info)


RED = (255, 0, 0, 255)


def store_watermark_png(
    test: unittest.TestCase,
    size: tuple[int, int] = (40, 20),
    colour: tuple[int, int, int, int] = RED,
) -> None:
    path = watermark_image_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", size, colour).save(path)
    test.addCleanup(path.unlink, missing_ok=True)


def red_box(image: Image.Image) -> tuple[int, int, int, int] | None:
    """Where the red mark landed on a black frame."""
    red, green, _blue = image.convert("RGB").split()
    # Text is white, so a pixel that is red but not green is the PNG's, never the text's.
    return ImageChops.multiply(
        red.point(lambda value: 255 if value > 40 else 0),
        green.point(lambda value: 255 if value < 40 else 0),
    ).getbbox()


def box_centre(box: tuple[int, int, int, int]) -> tuple[float, float]:
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


class WatermarkPngTests(unittest.TestCase):
    def test_each_position_puts_the_png_where_it_says(self) -> None:
        expected = {
            "top_left": (lambda x: x < 200, lambda y: y < 150),
            "top_right": (lambda x: x > 200, lambda y: y < 150),
            "center": (lambda x: abs(x - 200) < 2, lambda y: abs(y - 150) < 2),
            "bottom_left": (lambda x: x < 200, lambda y: y > 150),
            "bottom_right": (lambda x: x > 200, lambda y: y > 150),
        }
        store_watermark_png(self)
        for position, (check_x, check_y) in expected.items():
            with self.subTest(position=position), TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)

                run_watermark_job(
                    root, text_enabled=False, image_enabled=True, image_position=position
                )

                with Image.open(watermarked(root, "photo.png")) as output:
                    box = red_box(output)
                assert box is not None
                centre_x, centre_y = box_centre(box)
                self.assertTrue(check_x(centre_x), (position, box))
                self.assertTrue(check_y(centre_y), (position, box))

    def test_corners_keep_the_text_margin(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=1000, height=800)

            run_watermark_job(
                root, text_enabled=False, image_enabled=True, image_position="bottom_right"
            )

            with Image.open(watermarked(root, "photo.png")) as output:
                box = red_box(output)
        # 2% of the 800px height.
        self.assertEqual(box[2:] if box else None, (1000 - 16, 800 - 16))

    def test_fits_a_square_sized_from_the_shorter_side(self) -> None:
        store_watermark_png(self, size=(40, 20))
        widths = {}
        for size in ("small", "medium", "large"):
            with self.subTest(size=size), TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)

                run_watermark_job(root, text_enabled=False, image_enabled=True, image_size=size)

                with Image.open(watermarked(root, "photo.png")) as output:
                    box = red_box(output)
                assert box is not None
                widths[size] = box[2] - box[0]
                # A 2:1 logo keeps its aspect ratio.
                self.assertAlmostEqual(widths[size] / (box[3] - box[1]), 2, delta=0.1)

        # The wide side fills the square: 10%, 15% and 22% of 300px.
        self.assertEqual(widths, {"small": 30, "medium": 45, "large": 66})

    def test_opacity_fades_the_png(self) -> None:
        store_watermark_png(self)
        reds = {}
        for opacity in (25, 100):
            with TempMediaFolder() as root:
                write_media(root, "photo.png", width=400, height=300)

                run_watermark_job(
                    root,
                    text_enabled=False,
                    image_enabled=True,
                    image_opacity=opacity,
                    image_position="center",
                )

                with Image.open(watermarked(root, "photo.png")) as output:
                    reds[opacity] = output.convert("RGB").getpixel((200, 150))[0]

        self.assertEqual(reds[100], 255)
        self.assertAlmostEqual(reds[25], 64, delta=2)

    def test_png_transparency_shows_the_photo_through(self) -> None:
        store_watermark_png(self, colour=(255, 0, 0, 0))
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=400, height=300)

            run_watermark_job(root, text_enabled=False, image_enabled=True)

            with Image.open(watermarked(root, "photo.png")) as output:
                self.assertIsNone(output.convert("L").getbbox())

    def test_text_and_png_land_in_their_own_corners(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=400, height=300)

            run_watermark_job(
                root,
                text="Sample Studio",
                position="bottom_right",
                image_enabled=True,
                image_position="top_left",
            )

            with Image.open(watermarked(root, "photo.png")) as output:
                box = red_box(output)
                self.assertIsNotNone(bottom_right(output).convert("L").getbbox())
        assert box is not None
        self.assertLess(box_centre(box)[0], 200)
        self.assertLess(box_centre(box)[1], 150)

    def test_png_only_needs_neither_text_nor_a_font(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_media(root, "photo.png", width=200, height=150)

            with patch("automation.watermark.resolve_watermark_font", return_value=None):
                result = run_watermark_job(root, text_enabled=False, text="", image_enabled=True)

            self.assertEqual(result["processed"], 1)

    def test_transparent_png_source_keeps_its_alpha_channel(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            Image.new("RGBA", (200, 150), (0, 0, 0, 0)).save(root / "logo.png")

            run_watermark_job(root, text_enabled=False, image_enabled=True)

            with Image.open(watermarked(root, "logo.png")) as output:
                self.assertEqual(output.mode, "RGBA")

    def test_replacing_the_png_mid_job_does_not_change_the_rest(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_media(root, "first.png", width=200, height=150)
            write_media(root, "second.png", width=200, height=150)

            def replace_stored_png(*_: object) -> None:
                Image.new("RGBA", (40, 20), (0, 0, 255, 255)).save(watermark_image_path())

            run_watermark_job(
                root, text_enabled=False, image_enabled=True, on_progress=replace_stored_png
            )

            for name in ("first.png", "second.png"):
                with Image.open(watermarked(root, name)) as output:
                    self.assertIsNotNone(red_box(output), name)

    def test_an_unreadable_stored_png_refuses_the_job(self) -> None:
        store_watermark_png(self)
        watermark_image_path().write_bytes(b"not a png")
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, "cannot be read"):
                run_watermark_job(root, text_enabled=False, image_enabled=True)


class WatermarkPngValidationTests(unittest.TestCase):
    def test_needs_at_least_one_mark(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, NO_MARK_MESSAGE):
                validate_watermark_folder(root, text_enabled=False, image_enabled=False)

    def test_png_on_needs_a_stored_png(self) -> None:
        watermark_image_path().unlink(missing_ok=True)
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaisesRegex(ValueError, IMAGE_MISSING_MESSAGE):
                validate_watermark_folder(root, text_enabled=False, image_enabled=True)

    def test_text_off_ignores_the_text(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            validate_watermark_folder(root, text_enabled=False, text="   ", image_enabled=True)

    def test_refuses_unknown_png_settings(self) -> None:
        store_watermark_png(self)
        cases = {
            "image_size": ("huge", "PNG watermark size"),
            "image_opacity": (10, "PNG watermark opacity"),
            "image_position": ("top", "PNG watermark position"),
        }
        for key, (value, message) in cases.items():
            with self.subTest(key=key), TempMediaFolder() as root:
                write_media(root, "photo.png")

                with self.assertRaisesRegex(ValueError, message):
                    validate_watermark_folder(
                        root, text_enabled=False, image_enabled=True, **{key: value}
                    )


def image_mark(position: str = "bottom_right", scale: float = 0.15) -> ImageMark:
    return ImageMark(
        image=Image.new("RGBA", (4, 2)),
        path=Path("mark.png"),
        scale=scale,
        position=resolve_watermark_position(position),
    )


class WatermarkGraphTests(unittest.TestCase):
    def test_png_only_scales_against_the_frame_and_overlays_it(self) -> None:
        self.assertEqual(
            build_mark_graph(None, image_mark()),
            "[0:v:0]split[base][ref];"
            "[1:v][ref]scale=w=max(16\\,min(rw\\,rh)*0.15):h=max(16\\,min(rw\\,rh)*0.15)"
            ":force_original_aspect_ratio=decrease:flags=lanczos[mark];"
            "[base][mark]overlay=x=W-w-(max(8\\,H*0.02)):y=H-h-(max(8\\,H*0.02))"
            ":format=auto:shortest=1[marked]",
        )

    def test_positions_map_to_overlay_expressions(self) -> None:
        margin = "max(8\\,H*0.02)"
        cases = {
            "top_left": f"x={margin}:y={margin}",
            "top_right": f"x=W-w-({margin}):y={margin}",
            "center": "x=(W-w)/2:y=(H-h)/2",
            "bottom_left": f"x={margin}:y=H-h-({margin})",
            "bottom_right": f"x=W-w-({margin}):y=H-h-({margin})",
        }
        for position, expected in cases.items():
            with self.subTest(position=position):
                self.assertIn(f"overlay={expected}:", build_mark_graph(None, image_mark(position)))

    def test_text_is_drawn_after_the_png(self) -> None:
        graph = build_mark_graph(text_mark(), image_mark())
        self.assertIn("[imaged]", graph)
        self.assertLess(graph.index("overlay="), graph.index("drawtext="))
        self.assertTrue(graph.endswith("[marked]"))

    def test_text_only_draws_straight_from_the_source(self) -> None:
        graph = build_mark_graph(text_mark(), None)
        self.assertTrue(graph.startswith("[0:v:0]drawtext="))
        self.assertNotIn("[1:v]", graph)

    def test_the_video_command_loops_the_png_and_drops_the_display_matrix(self) -> None:
        commands: list[list[str]] = []

        with patch(
            "automation.watermark.run_ffmpeg",
            side_effect=lambda command, **_: commands.append(command),
        ):
            watermark_module.watermark_video(
                Path("in.mp4"), Path("out.mp4"), text=None, image=image_mark(), ffmpeg="ffmpeg"
            )

        command = commands[0]
        second_input = command.index("-i", command.index("-i") + 1)
        self.assertEqual(
            command[second_input - 2 : second_input + 2], ["-loop", "1", "-i", "mark.png"]
        )
        graph = command[command.index("-filter_complex") + 1]
        self.assertTrue(graph.endswith(";[marked]sidedata=mode=delete:type=DISPLAYMATRIX[v]"))

    def test_the_gif_command_marks_before_building_palettes(self) -> None:
        command = build_gif_watermark_command(
            Path("in.gif"),
            Path("out.gif"),
            executable="ffmpeg",
            text=None,
            image=image_mark(),
            loop="0",
        )

        graph = command[command.index("-filter_complex") + 1]
        self.assertLess(graph.index("overlay="), graph.index("palettegen"))
        self.assertIn("mark.png", command)


def make_black_mp4(root: Path, name: str, *, rotation: int | None = None) -> Path:
    executable = ffmpeg_path()
    assert executable is not None
    plain = root / f"plain-{name}"
    subprocess.run(
        [
            executable,
            *("-nostdin", "-v", "error", "-y"),
            *("-f", "lavfi", "-i", "color=black:size=160x120:rate=10:duration=0.5"),
            *("-c:v", "libx264", "-pix_fmt", "yuv420p", str(plain)),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    if rotation is None:
        return plain.rename(root / name)
    rotated = root / name
    subprocess.run(
        [
            executable,
            *("-nostdin", "-v", "error", "-y"),
            *("-display_rotation", str(rotation), "-i", str(plain), "-c", "copy", str(rotated)),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    plain.unlink()
    return rotated


def first_frame(video: Path, root: Path) -> Image.Image:
    """Decoded as a player would show it, display matrix applied."""
    executable = ffmpeg_path()
    assert executable is not None
    frame = root / "frame.png"
    subprocess.run(
        [
            executable,
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(frame),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    with Image.open(frame) as opened:
        return opened.convert("RGB")


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class WatermarkPngEncodeTests(unittest.TestCase):
    """Real encodes: frame-relative scaling and the display matrix only show in the output."""

    def test_marks_a_video_in_the_chosen_corner_at_the_chosen_size(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            make_black_mp4(root, "clip.mp4")

            result = run_watermark_job(
                root, text_enabled=False, image_enabled=True, image_position="top_right"
            )

            self.assertEqual(result["processed"], 1)
            with TempMediaFolder() as scratch:
                frame = first_frame(watermarked(root, "clip.mp4"), scratch)
            box = red_box(frame)
            assert box is not None
            self.assertEqual(frame.size, (160, 120))
            self.assertGreater(box_centre(box)[0], 80)
            self.assertLess(box_centre(box)[1], 60)
            # 15% of the 120px short side, give or take chroma bleed.
            self.assertAlmostEqual(box[2] - box[0], 18, delta=3)

    def test_a_rotated_video_is_marked_upright_and_not_rotated_again(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            make_black_mp4(root, "portrait.mp4", rotation=90)

            run_watermark_job(
                root, text_enabled=False, image_enabled=True, image_position="bottom_left"
            )

            with TempMediaFolder() as scratch:
                frame = first_frame(watermarked(root, "portrait.mp4"), scratch)
            # A display matrix left on the copy would turn it back to landscape here.
            self.assertEqual(frame.size, (120, 160))
            box = red_box(frame)
            assert box is not None
            self.assertLess(box_centre(box)[0], 60)
            self.assertGreater(box_centre(box)[1], 80)
            # Still a 2:1 logo: it was scaled after the rotation, not before.
            self.assertGreater(box[2] - box[0], box[3] - box[1])

    def test_marks_every_gif_frame_and_keeps_the_frame_count(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_flat_gif(
                root,
                "loop.gif",
                colours=[(20, 20, 20), (30, 30, 30), (40, 40, 40)],
                durations=[100, 100, 100],
                loop=0,
            )

            run_watermark_job(root, text_enabled=False, image_enabled=True, image_size="large")

            frames, delays, _ = read_gif(watermarked(root, "loop.gif"))
            self.assertEqual(delays, [100, 100, 100])
            for frame in frames:
                self.assertIsNotNone(red_box(frame))

    def test_a_transparent_gif_keeps_its_transparency_around_the_png(self) -> None:
        store_watermark_png(self)
        with TempMediaFolder() as root:
            write_flat_gif(
                root,
                "clear.gif",
                colours=[(255, 0, 0), (0, 0, 255)],
                durations=[100, 100],
                transparent=True,
            )

            run_watermark_job(root, text_enabled=False, image_enabled=True)

            frames, _, _ = read_gif(watermarked(root, "clear.gif"))
            self.assertEqual([frame.getpixel((5, 5))[3] for frame in frames], [0, 0])


if __name__ == "__main__":
    unittest.main()
