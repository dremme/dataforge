from __future__ import annotations

import json
import unittest.mock

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from PIL import Image, UnidentifiedImageError

from automation.strip_metadata import (
    list_strip_metadata_files,
    run_strip_metadata_job,
    strip_file_metadata,
    strip_isobmff_metadata,
    strip_jpeg_metadata,
    strip_png_metadata,
    strip_webp_metadata,
    validate_strip_metadata_folder,
)
from comfy_metadata import _parse_isobmff_metadata, _parse_png_text_chunks, media_has_comfy_workflow
from testing_fixtures import (
    TempMediaFolder,
    make_minimal_mp4_bytes,
    write_gif,
    write_image,
    write_jpeg,
    write_media,
    write_mp4_video,
)


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

    def test_strip_png_metadata_removes_text_chunks(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(
                root,
                "comfy.png",
                text_chunks={"workflow": json.dumps({"nodes": {"1": {"class_type": "KSampler"}}})},
            )

            self.assertTrue(media_has_comfy_workflow(media))

            strip_png_metadata(media)

            chunks = _parse_png_text_chunks(media.read_bytes())
            self.assertEqual(chunks, {})
            self.assertFalse(media_has_comfy_workflow(media))

    def test_run_job_processes_images_and_videos(self) -> None:
        with TempMediaFolder() as root:
            png = write_media(root, "photo.png", text_chunks={"comment": "secret"})
            write_mp4_video(
                root,
                "clip.mp4",
                metadata={"comment": "workflow prompt", "workflow": '{"nodes":{}}'},
            )

            with unittest.mock.patch(
                "automation.strip_metadata.strip_isobmff_metadata",
                side_effect=lambda path, ffmpeg=None, should_cancel=None: None,
            ) as strip_video:
                result = run_strip_metadata_job(root)

            strip_video.assert_called_once()
            self.assertEqual(result["total"], 2)
            self.assertEqual(result["stats"]["success"], 2)
            self.assertEqual(result["stats"]["image_success"], 1)
            self.assertEqual(result["stats"]["video_success"], 1)
            self.assertEqual(_parse_png_text_chunks(png.read_bytes()), {})


class StripJpegMetadataTests(unittest.TestCase):
    def test_removes_exif_without_re_encoding_the_scan(self) -> None:
        with TempMediaFolder() as root:
            media = write_jpeg(root, "photo.jpg", orientation=3)
            original = media.read_bytes()
            with Image.open(media) as opened:
                self.assertTrue(dict(opened.getexif()))

            strip_jpeg_metadata(media)

            stripped = media.read_bytes()
            with Image.open(media) as opened:
                self.assertEqual(dict(opened.getexif()), {})
            self.assertLess(len(stripped), len(original))
            # The whole point of the marker rewrite: the compressed pixels are untouched.
            self.assertEqual(jpeg_scan(stripped), jpeg_scan(original))

    def test_keeps_the_colour_critical_segments(self) -> None:
        from PIL import ImageCms

        with TempMediaFolder() as root:
            media = root / "photo.jpg"
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
            exif = Image.Exif()
            exif[0x0112] = 3
            Image.new("RGB", (64, 48), (30, 60, 90)).save(
                media, format="JPEG", exif=exif, icc_profile=profile
            )

            strip_jpeg_metadata(media)

            with Image.open(media) as stripped:
                self.assertEqual(dict(stripped.getexif()), {})
                self.assertIsNotNone(stripped.info.get("icc_profile"))
                # APP0 carries pixel density, which Pillow surfaces as dpi.
                self.assertIsNotNone(stripped.info.get("jfif"))

    def test_stripping_twice_changes_nothing(self) -> None:
        with TempMediaFolder() as root:
            media = write_jpeg(root, "photo.jpg", orientation=3)

            strip_jpeg_metadata(media)
            once = media.read_bytes()
            strip_jpeg_metadata(media)

            self.assertEqual(media.read_bytes(), once)

    def test_rejects_a_file_that_is_not_a_jpeg(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.jpg"
            media.write_bytes(b"not a jpeg at all")

            with self.assertRaises(UnidentifiedImageError):
                strip_jpeg_metadata(media)

            # The refusal must not have published a half-written temp over the original.
            self.assertEqual(media.read_bytes(), b"not a jpeg at all")


class StripWebpMetadataTests(unittest.TestCase):
    def _write_webp_with_exif(self, root, name: str = "photo.webp"):
        media = root / name
        exif = Image.Exif()
        exif[0x0112] = 3
        Image.new("RGB", (64, 48), (10, 20, 30)).save(media, format="WEBP", exif=exif.tobytes())
        return media

    def test_removes_the_exif_chunk_and_clears_the_vp8x_flag(self) -> None:
        with TempMediaFolder() as root:
            media = self._write_webp_with_exif(root)
            chunks = webp_chunks(media.read_bytes())
            self.assertIn(b"EXIF", chunks)
            self.assertTrue(chunks[b"VP8X"][0] & 0x08)
            with Image.open(media) as opened:
                pixels = opened.convert("RGB").tobytes()

            strip_webp_metadata(media)

            stripped = webp_chunks(media.read_bytes())
            self.assertNotIn(b"EXIF", stripped)
            self.assertFalse(stripped[b"VP8X"][0] & 0x08)
            with Image.open(media) as opened:
                self.assertEqual(dict(opened.getexif()), {})
                self.assertEqual(opened.convert("RGB").tobytes(), pixels)

    def test_leaves_a_webp_without_metadata_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_image(root, "plain.webp")
            original = media.read_bytes()

            strip_webp_metadata(media)

            self.assertEqual(media.read_bytes(), original)

    def test_rejects_a_file_that_is_not_a_webp(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.webp"
            media.write_bytes(b"RIFF____NOTWEBPDATA")

            with self.assertRaises(UnidentifiedImageError):
                strip_webp_metadata(media)


def png_chunk_types(data: bytes) -> list[bytes]:
    types: list[bytes] = []
    index = 8
    while index + 8 <= len(data):
        length = int.from_bytes(data[index : index + 4], "big")
        types.append(data[index + 4 : index + 8])
        index += 12 + length
    return types


def make_png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    import struct
    import zlib

    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)
    )


def insert_after_ihdr(data: bytes, chunk: bytes) -> bytes:
    ihdr_end = 8 + 12 + int.from_bytes(data[8:12], "big")
    return data[:ihdr_end] + chunk + data[ihdr_end:]


class StripPngMetadataTests(unittest.TestCase):
    def test_keeps_the_colour_and_density_chunks(self) -> None:
        from io import BytesIO

        from PIL import ImageCms

        with TempMediaFolder() as root:
            media = root / "photo.png"
            profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
            exif = Image.Exif()
            exif[0x0112] = 3
            buffer = BytesIO()
            Image.new("RGB", (64, 48), (30, 60, 90)).save(
                buffer, format="PNG", icc_profile=profile, dpi=(72, 72), exif=exif.tobytes()
            )
            # gAMA has no Pillow save option, so it is injected as a raw chunk.
            media.write_bytes(
                insert_after_ihdr(buffer.getvalue(), make_png_chunk(b"gAMA", b"\x00\x00\xb1\x8f"))
            )

            before = png_chunk_types(media.read_bytes())
            self.assertIn(b"eXIf", before)

            strip_png_metadata(media)

            after = png_chunk_types(media.read_bytes())
            for kept in (b"iCCP", b"pHYs", b"gAMA"):
                self.assertIn(kept, after)
            self.assertNotIn(b"eXIf", after)
            with Image.open(media) as opened:
                self.assertIsNotNone(opened.info.get("icc_profile"))
                # pHYs stores pixels-per-metre as an integer, so 72 dpi round-trips to ~72.009.
                dpi = opened.info.get("dpi")
                self.assertIsNotNone(dpi)
                self.assertAlmostEqual(dpi[0], 72, delta=0.1)

    def test_keeps_paletted_transparency(self) -> None:
        with TempMediaFolder() as root:
            media = root / "sprite.png"
            image = Image.new("P", (16, 16), 0)
            image.putpalette([0, 0, 0, 255, 255, 255] + [0] * (256 * 3 - 6))
            image.info["transparency"] = 0
            image.save(media, format="PNG", transparency=0)

            strip_png_metadata(media)

            self.assertIn(b"tRNS", png_chunk_types(media.read_bytes()))
            with Image.open(media) as opened:
                self.assertEqual(opened.mode, "P")
                self.assertIn("transparency", opened.info)

    def test_removes_exif_and_text_without_re_encoding_the_pixels(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "comfy.png", text_chunks={"comment": "secret"})
            original_idat = b"".join(
                data for cid, data in _iter_png_chunks(media.read_bytes()) if cid == b"IDAT"
            )

            strip_png_metadata(media)

            stripped = media.read_bytes()
            self.assertEqual(_parse_png_text_chunks(stripped), {})
            # The whole point of the chunk rewrite: the compressed pixels are untouched.
            self.assertEqual(
                b"".join(data for cid, data in _iter_png_chunks(stripped) if cid == b"IDAT"),
                original_idat,
            )

    def test_stripping_twice_changes_nothing(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "comfy.png", text_chunks={"comment": "secret"})

            strip_png_metadata(media)
            once = media.read_bytes()
            strip_png_metadata(media)

            self.assertEqual(media.read_bytes(), once)

    def test_rejects_a_file_that_is_not_a_png(self) -> None:
        with TempMediaFolder() as root:
            media = root / "photo.png"
            media.write_bytes(b"not a png at all")

            with self.assertRaises(UnidentifiedImageError):
                strip_png_metadata(media)

            # The refusal must not have published a half-written temp over the original.
            self.assertEqual(media.read_bytes(), b"not a png at all")
            self.assertEqual(list(root.glob("*.strip-meta.*")), [])


def _iter_png_chunks(data: bytes):
    index = 8
    while index + 8 <= len(data):
        length = int.from_bytes(data[index : index + 4], "big")
        yield data[index + 4 : index + 8], data[index + 8 : index + 8 + length]
        index += 12 + length


class StripFileMetadataDispatchTests(unittest.TestCase):
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
                with unittest.mock.patch(
                    "automation.strip_metadata.strip_isobmff_metadata"
                ) as strip_video:
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
            with unittest.mock.patch("automation.strip_metadata.ffmpeg_path", return_value=None):
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
                from pathlib import Path

                commands.append(command)
                Path(command[-1]).write_bytes(make_minimal_mp4_bytes())

            with unittest.mock.patch("automation.strip_metadata.run_ffmpeg", side_effect=fake_run):
                strip_isobmff_metadata(media, ffmpeg=str(fake_ffmpeg))

            self.assertFalse(_parse_isobmff_metadata(media.read_bytes()))
            # Without bitexact the muxer writes its own encoder tag over the stripped file.
            self.assertIn("+bitexact", commands[0])
            # +faststart keeps the copy a plain streamable MP4; use_metadata_tags left an empty
            # Apple key/value shell that some players refused to open.
            self.assertIn("+faststart", commands[0])
            self.assertNotIn("use_metadata_tags", commands[0])

    def test_a_cancel_during_the_video_strip_removes_the_temp(self) -> None:
        from ffmpeg_run import FfmpegCancelled

        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()
            fake_ffmpeg = root / "ffmpeg.exe"
            fake_ffmpeg.write_text("", encoding="utf-8")

            def fake_run(command, *_args, **_kwargs):
                from pathlib import Path

                # A real cancel can land after ffmpeg has begun writing the temp.
                Path(command[-1]).write_bytes(b"partial")
                raise FfmpegCancelled

            with unittest.mock.patch("automation.strip_metadata.run_ffmpeg", side_effect=fake_run):
                with self.assertRaises(FfmpegCancelled):
                    strip_isobmff_metadata(media, ffmpeg=str(fake_ffmpeg))

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob("*.strip-meta.*")), [])

    def test_run_job_reports_ffmpeg_errors(self) -> None:
        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})

            with unittest.mock.patch(
                "automation.strip_metadata.strip_isobmff_metadata",
                side_effect=RuntimeError("ffmpeg failed to strip video metadata"),
            ):
                result = run_strip_metadata_job(root)

            self.assertEqual(result["stats"]["ffmpeg_error"], 1)
            self.assertEqual(result["results"][0]["status"], "ffmpeg_error")

    def test_run_job_reports_a_cancel_instead_of_letting_it_escape(self) -> None:
        from ffmpeg_run import FfmpegCancelled

        with TempMediaFolder() as root:
            write_mp4_video(root, "clip.mp4", metadata={"comment": "secret"})

            with unittest.mock.patch(
                "automation.strip_metadata.strip_isobmff_metadata",
                side_effect=FfmpegCancelled,
            ):
                result = run_strip_metadata_job(root)

            self.assertEqual(result["stats"]["cancelled"], 1)
            self.assertEqual(result["results"][0]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
