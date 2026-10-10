from __future__ import annotations

import json
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from testing_fixtures import isolate_test_database

isolate_test_database()

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from automation.strip_metadata import (
    list_strip_metadata_files,
    run_strip_metadata_job,
    strip_file_metadata,
    strip_isobmff_metadata,
    validate_strip_metadata_folder,
)
from comfy_metadata import _parse_isobmff_metadata, _parse_png_text_chunks, media_has_comfy_workflow
from ffmpeg_run import FfmpegCancelled
from testing_fixtures import (
    TempMediaFolder,
    make_minimal_mp4_bytes,
    png_chunk,
    write_gif,
    write_image,
    write_jpeg,
    write_media,
    write_mp4_video,
)

#: A provenance tag; Orientation stays through a strip, so it cannot stand in for EXIF here.
CAMERA_MAKE_TAG = 0x010F


def jpeg_scan(data: bytes) -> bytes:
    """The entropy-coded tail from SOS onward. Searching for the bytes would match APP payloads."""
    index = 2
    while index + 1 < len(data):
        marker = data[index + 1]
        if marker == 0xFF:
            index += 1
            continue
        if marker == 0xDA:
            return data[index:]
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        index += 2 + int.from_bytes(data[index + 2 : index + 4], "big")
    raise AssertionError("no SOS marker in JPEG")


def webp_chunks(data: bytes) -> dict[bytes, bytes]:
    chunks: dict[bytes, bytes] = {}
    index = 12
    while index + 8 <= len(data):
        chunk_type = data[index : index + 4]
        size = int.from_bytes(data[index + 4 : index + 8], "little")
        chunks[chunk_type] = data[index + 8 : index + 8 + size]
        index += 8 + size + (size & 1)
    return chunks


def png_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    chunks: list[tuple[bytes, bytes]] = []
    index = 8
    while index + 8 <= len(data):
        length = int.from_bytes(data[index : index + 4], "big")
        chunks.append((data[index + 4 : index + 8], data[index + 8 : index + 8 + length]))
        index += 12 + length
    return chunks


def png_idat(data: bytes) -> bytes:
    return b"".join(payload for chunk_type, payload in png_chunks(data) if chunk_type == b"IDAT")


def insert_after_ihdr(data: bytes, chunk: bytes) -> bytes:
    ihdr_end = 8 + 12 + int.from_bytes(data[8:12], "big")
    return data[:ihdr_end] + chunk + data[ihdr_end:]


def write_webp_with_exif(root: Path, name: str = "photo.webp") -> Path:
    media = root / name
    exif = Image.Exif()
    exif[CAMERA_MAKE_TAG] = "Example Camera"
    Image.new("RGB", (64, 48), (10, 20, 30)).save(media, format="WEBP", exif=exif.tobytes())
    return media


class StripMetadataFileTests(unittest.TestCase):
    def test_lists_image_and_mp4_family_files(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            write_jpeg(root, "photo.jpg")
            write_image(root, "photo.webp")
            write_image(root, "photo.bmp")
            write_mp4_video(root, "clip.mp4")
            write_mp4_video(root, "clip.mov")
            (root / "notes.txt").write_text("ignore", encoding="utf-8")
            # Re-encoding an animated GIF through Pillow risks palette and timing loss.
            write_gif(root, "loop.gif")

            files = list_strip_metadata_files(root)

        self.assertEqual(
            {path.name for path in files},
            {"photo.png", "photo.jpg", "photo.webp", "photo.bmp", "clip.mp4", "clip.mov"},
        )

    def test_validate_requires_supported_files(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaisesRegex(ValueError, "No JPG, PNG, WebP, BMP, MP4, MOV or M4V"):
                validate_strip_metadata_folder(root)

    def test_run_job_processes_images_and_videos(self) -> None:
        with TempMediaFolder() as root:
            png = write_media(root, "photo.png", text_chunks={"comment": "secret"})
            write_mp4_video(
                root,
                "clip.mp4",
                metadata={"comment": "workflow prompt", "workflow": '{"nodes":{}}'},
            )

            with patch("automation.strip_metadata.strip_isobmff_metadata") as strip_video:
                result = run_strip_metadata_job(root)

            strip_video.assert_called_once()
            self.assertEqual(_parse_png_text_chunks(png.read_bytes()), {})

        self.assertEqual(result["total"], 2)
        self.assertEqual(result["stats"]["success"], 2)
        self.assertEqual(result["stats"]["image_success"], 1)
        self.assertEqual(result["stats"]["video_success"], 1)


class StripJpegMetadataTests(unittest.TestCase):
    def test_removes_exif_without_re_encoding_the_scan(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.jpg"
            exif = Image.Exif()
            exif[CAMERA_MAKE_TAG] = "Example Camera"
            Image.new("RGB", (64, 48)).save(media, format="JPEG", exif=exif)
            original = media.read_bytes()
            with Image.open(media) as opened:
                self.assertTrue(dict(opened.getexif()))

            strip_file_metadata(media)

            stripped = media.read_bytes()
            with Image.open(media) as opened:
                self.assertEqual(dict(opened.getexif()), {})

        self.assertLess(len(stripped), len(original))
        # The whole point of the marker rewrite: the compressed pixels are untouched.
        self.assertEqual(jpeg_scan(stripped), jpeg_scan(original))

    def test_keeps_the_colour_critical_segments(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.jpg"
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
            exif = Image.Exif()
            exif[CAMERA_MAKE_TAG] = "Example Camera"
            Image.new("RGB", (64, 48), (30, 60, 90)).save(
                media, format="JPEG", exif=exif, icc_profile=profile
            )

            strip_file_metadata(media)

            with Image.open(media) as stripped:
                self.assertEqual(dict(stripped.getexif()), {})
                self.assertIsNotNone(stripped.info.get("icc_profile"))
                # APP0 carries pixel density, which Pillow surfaces as dpi.
                self.assertIsNotNone(stripped.info.get("jfif"))


class StripWebpMetadataTests(unittest.TestCase):
    def test_removes_the_exif_chunk_and_clears_the_vp8x_flag(self) -> None:
        with TempMediaFolder() as root:
            media = write_webp_with_exif(root)
            chunks = webp_chunks(media.read_bytes())
            self.assertIn(b"EXIF", chunks)
            self.assertTrue(chunks[b"VP8X"][0] & 0x08)
            with Image.open(media) as opened:
                pixels = opened.convert("RGB").tobytes()

            strip_file_metadata(media)

            stripped = webp_chunks(media.read_bytes())
            with Image.open(media) as opened:
                self.assertEqual(dict(opened.getexif()), {})
                self.assertEqual(opened.convert("RGB").tobytes(), pixels)

        self.assertNotIn(b"EXIF", stripped)
        self.assertFalse(stripped[b"VP8X"][0] & 0x08)

    def test_leaves_a_webp_without_metadata_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "plain.webp")
            original = media.read_bytes()

            strip_file_metadata(media)

            self.assertEqual(media.read_bytes(), original)


class StripPngMetadataTests(unittest.TestCase):
    def test_keeps_the_colour_and_density_chunks(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.png"
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
            exif = Image.Exif()
            exif[CAMERA_MAKE_TAG] = "Example Camera"
            buffer = BytesIO()
            Image.new("RGB", (64, 48), (30, 60, 90)).save(
                buffer, format="PNG", icc_profile=profile, dpi=(72, 72), exif=exif.tobytes()
            )
            # gAMA has no Pillow save option, so it is injected as a raw chunk.
            media.write_bytes(
                insert_after_ihdr(buffer.getvalue(), png_chunk(b"gAMA", b"\x00\x00\xb1\x8f"))
            )
            self.assertIn(b"eXIf", [chunk_type for chunk_type, _ in png_chunks(media.read_bytes())])

            strip_file_metadata(media)

            after = [chunk_type for chunk_type, _ in png_chunks(media.read_bytes())]
            with Image.open(media) as opened:
                self.assertIsNotNone(opened.info.get("icc_profile"))
                # pHYs stores pixels-per-metre as an integer, so 72 dpi round-trips to ~72.009.
                self.assertAlmostEqual(opened.info["dpi"][0], 72, delta=0.1)

        for kept in (b"iCCP", b"pHYs", b"gAMA"):
            self.assertIn(kept, after)
        self.assertNotIn(b"eXIf", after)

    def test_keeps_paletted_transparency(self) -> None:
        with TempMediaFolder() as root:
            media = root / "sprite.png"
            image = Image.new("P", (16, 16), 0)
            image.putpalette([0, 0, 0, 255, 255, 255] + [0] * (256 * 3 - 6))
            image.save(media, format="PNG", transparency=0)

            strip_file_metadata(media)

            self.assertIn(b"tRNS", [chunk_type for chunk_type, _ in png_chunks(media.read_bytes())])
            with Image.open(media) as opened:
                self.assertEqual(opened.mode, "P")
                self.assertIn("transparency", opened.info)

    def test_removes_the_workflow_text_without_re_encoding_the_pixels(self) -> None:
        with TempMediaFolder() as root:
            workflow = json.dumps({"nodes": {"1": {"class_type": "KSampler"}}})
            media = write_media(root, "comfy.png", text_chunks={"workflow": workflow})
            self.assertTrue(media_has_comfy_workflow(media))
            original_idat = png_idat(media.read_bytes())

            strip_file_metadata(media)

            stripped = media.read_bytes()
            self.assertFalse(media_has_comfy_workflow(media))

        self.assertEqual(_parse_png_text_chunks(stripped), {})
        # The whole point of the chunk rewrite: the compressed pixels are untouched.
        self.assertEqual(png_idat(stripped), original_idat)


class StripFileMetadataDispatchTests(unittest.TestCase):
    def test_stripping_twice_changes_nothing(self) -> None:
        writers = {
            "jpeg": lambda root: write_jpeg(root, "photo.jpg", orientation=3),
            "png": lambda root: write_media(root, "comfy.png", text_chunks={"comment": "secret"}),
            "webp": write_webp_with_exif,
        }
        for kind, write in writers.items():
            with self.subTest(kind=kind), TempMediaFolder() as root:
                media = write(root)

                strip_file_metadata(media)
                once = media.read_bytes()
                strip_file_metadata(media)

                self.assertEqual(media.read_bytes(), once)

    def test_rejects_a_file_that_is_not_what_its_suffix_says(self) -> None:
        for name, data in (
            ("photo.jpg", b"not a jpeg at all"),
            ("photo.png", b"not a png at all"),
            ("photo.webp", b"RIFF____NOTWEBPDATA"),
        ):
            with self.subTest(name=name), TempMediaFolder() as root:
                media = root / name
                media.write_bytes(data)

                with self.assertRaises(UnidentifiedImageError):
                    strip_file_metadata(media)

                # The refusal must not have published a half-written temp over the original.
                self.assertEqual(media.read_bytes(), data)
                self.assertEqual(list(root.glob("*.strip-meta.*")), [])

    def test_bmp_is_left_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "photo.bmp")
            original = media.read_bytes()

            self.assertEqual(strip_file_metadata(media), "image")

            # BMP has no metadata container, so a rewrite would only risk the pixels.
            self.assertEqual(media.read_bytes(), original)

    def test_the_whole_mp4_family_routes_to_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            for name in ("clip.mp4", "clip.mov", "clip.m4v"):
                media = write_mp4_video(root, name)
                with patch("automation.strip_metadata.strip_isobmff_metadata") as strip_video:
                    self.assertEqual(strip_file_metadata(media, ffmpeg="ffmpeg"), "video")
                strip_video.assert_called_once_with(media, ffmpeg="ffmpeg", should_cancel=None)

    def test_refuses_an_unsupported_suffix(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with self.assertRaises(UnidentifiedImageError):
                strip_file_metadata(media)


class StripIsobmffMetadataTests(unittest.TestCase):
    def test_requires_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            with patch("automation.strip_metadata.ffmpeg_path", return_value=None):
                with self.assertRaisesRegex(RuntimeError, "ffmpeg is required"):
                    strip_isobmff_metadata(media)

    def test_strips_metadata_with_ffmpeg_copy(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})
            self.assertEqual(_parse_isobmff_metadata(media.read_bytes()).get("comment"), "secret")
            fake_ffmpeg = root / "ffmpeg.exe"
            fake_ffmpeg.write_text("", encoding="utf-8")
            commands: list[list[str]] = []

            def fake_run(command, *_args, **_kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(make_minimal_mp4_bytes())

            with patch("automation.strip_metadata.run_ffmpeg", side_effect=fake_run):
                strip_isobmff_metadata(media, ffmpeg=str(fake_ffmpeg))

            self.assertFalse(_parse_isobmff_metadata(media.read_bytes()))

        # Without bitexact the muxer writes its own encoder tag over the stripped file.
        self.assertIn("+bitexact", commands[0])
        # +faststart keeps a plain streamable MP4; use_metadata_tags left a shell some players refused.
        self.assertIn("+faststart", commands[0])
        self.assertNotIn("use_metadata_tags", commands[0])

    def test_a_cancel_during_the_video_strip_removes_the_temp(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()
            fake_ffmpeg = root / "ffmpeg.exe"
            fake_ffmpeg.write_text("", encoding="utf-8")

            def fake_run(command, *_args, **_kwargs):
                # A real cancel can land after ffmpeg has begun writing the temp.
                Path(command[-1]).write_bytes(b"partial")
                raise FfmpegCancelled

            with patch("automation.strip_metadata.run_ffmpeg", side_effect=fake_run):
                with self.assertRaises(FfmpegCancelled):
                    strip_isobmff_metadata(media, ffmpeg=str(fake_ffmpeg))

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob("*.strip-meta.*")), [])

    def test_run_job_reports_ffmpeg_errors_and_cancels_per_file(self) -> None:
        cases = (
            (RuntimeError("ffmpeg failed to strip video metadata"), "ffmpeg_error"),
            (FfmpegCancelled, "cancelled"),
        )
        for error, status in cases:
            with (
                self.subTest(status=status),
                TempMediaFolder() as root,
                patch("automation.strip_metadata.strip_isobmff_metadata", side_effect=error),
            ):
                write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})

                result = run_strip_metadata_job(root)

                self.assertEqual(result["stats"][status], 1)
                self.assertEqual(result["results"][0]["status"], status)


class StripKeepsOrientationTests(unittest.TestCase):
    """Orientation decides how the pixels display; dropping it would turn the training image."""

    def _photo(self, root: Path, suffix: str, orientation: int) -> Path:
        exif = Image.Exif()
        exif[0x0112] = orientation
        exif[0x010F] = "Example Camera"  # Make: provenance, which must still go.
        media = root / f"photo{suffix}"
        Image.new("RGB", (32, 16), (200, 40, 40)).save(media, exif=exif.tobytes())
        return media

    def test_every_orientation_displays_the_same_after_stripping(self) -> None:
        for suffix in (".jpg", ".png", ".webp"):
            for orientation in range(1, 9):
                with self.subTest(suffix=suffix, orientation=orientation):
                    with TempMediaFolder() as root:
                        media = self._photo(root, suffix, orientation)
                        with Image.open(media) as before:
                            shown = ImageOps.exif_transpose(before).size

                        strip_file_metadata(media)

                        with Image.open(media) as after:
                            exif = after.getexif()
                            self.assertEqual(ImageOps.exif_transpose(after).size, shown)
                            self.assertEqual(exif.get(0x0112, 1), orientation)
                            self.assertNotIn(0x010F, exif)


if __name__ == "__main__":
    unittest.main()
