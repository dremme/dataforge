"""Unit tests for header-only media dimension probing."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from caption_cache import clear_caption_cache_for_tests
from media_dimensions import media_dimensions
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_image,
    write_jpeg,
    write_media,
    write_mp4_video,
    write_sysprompt,
)


def _dimensions(path, media_type: str):
    stat = path.stat()
    return media_dimensions(path, media_type, stat.st_mtime_ns, stat.st_size)


class ImageDimensionTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_reads_png_jpeg_and_gif(self) -> None:
        with TempMediaFolder() as root:
            png = write_media(root, "photo.png", width=800, height=600)
            jpeg = write_jpeg(root, "beach.jpg", width=320, height=240)
            gif = write_gif(root, "loop.gif", width=120, height=90)

            self.assertEqual(_dimensions(png, "image"), (800, 600))
            self.assertEqual(_dimensions(jpeg, "image"), (320, 240))
            self.assertEqual(_dimensions(gif, "gif"), (120, 90))

    def test_reads_webp_and_bmp(self) -> None:
        with TempMediaFolder() as root:
            webp = write_image(root, "photo.webp", width=640, height=360)
            bmp = write_image(root, "photo.bmp", width=200, height=100)

            self.assertEqual(_dimensions(webp, "image"), (640, 360))
            self.assertEqual(_dimensions(bmp, "image"), (200, 100))

    def test_returns_none_for_a_malformed_image(self) -> None:
        with TempMediaFolder() as root:
            truncated = root / "truncated.png"
            truncated.write_bytes(b"\x89PNG\r\n\x1a\n")

            self.assertIsNone(_dimensions(truncated, "image"))

    def test_returns_none_for_a_missing_file(self) -> None:
        with TempMediaFolder() as root:
            missing = root / "gone.png"

            self.assertIsNone(media_dimensions(missing, "image", 0, 0))

    def test_returns_none_for_a_type_without_pixels(self) -> None:
        with TempMediaFolder() as root:
            sysprompt = write_sysprompt(root, "A system prompt.")

            self.assertIsNone(_dimensions(sysprompt, "sysprompt"))


class VideoDimensionTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_reads_the_track_header(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, width=1920, height=1080)

            self.assertEqual(_dimensions(video, "video"), (1920, 1080))

    def test_reads_a_64_bit_track_header(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, width=1280, height=720, tkhd_version=1)

            self.assertEqual(_dimensions(video, "video"), (1280, 720))

    def test_finds_a_header_written_after_the_sample_data(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, width=720, height=1280, trailing_moov=True)

            self.assertEqual(_dimensions(video, "video"), (720, 1280))

    def test_reads_the_rest_of_the_mp4_family(self) -> None:
        with TempMediaFolder() as root:
            mov = write_mp4_video(root, "clip.mov", width=1440, height=1080)
            m4v = write_mp4_video(root, "clip.m4v", width=640, height=480)

            self.assertEqual(_dimensions(mov, "video"), (1440, 1080))
            self.assertEqual(_dimensions(m4v, "video"), (640, 480))

    def test_returns_none_for_a_container_that_is_not_isobmff(self) -> None:
        """A matroska or avi file has no box structure to walk, so it is not opened."""
        with TempMediaFolder() as root:
            for name in ("clip.mkv", "clip.avi", "clip.wmv", "clip.flv"):
                with self.subTest(name=name):
                    # MP4 bytes under a non-MP4 name: only the suffix should decide,
                    # so a parseable payload must still come back empty.
                    disguised = write_mp4_video(root, name, width=1920, height=1080)
                    self.assertIsNone(_dimensions(disguised, "video"))

    def test_returns_none_when_the_file_carries_no_header(self) -> None:
        with TempMediaFolder() as root:
            headerless = root / "headerless.mp4"
            headerless.write_bytes(b"\x00\x00\x00\x10ftypisom\x00\x00\x02\x00")

            self.assertIsNone(_dimensions(headerless, "video"))

    def test_returns_none_for_a_truncated_file(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)
            video.write_bytes(video.read_bytes()[:12])

            self.assertIsNone(_dimensions(video, "video"))


class DimensionCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def tearDown(self) -> None:
        clear_caption_cache_for_tests()

    def test_rereads_only_after_the_file_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png", width=800, height=600)
            stat = media.stat()

            self.assertEqual(_dimensions(media, "image"), (800, 600))

            # Same stat signature, different bytes: the memo is what answers here,
            # which is what keeps a repeat listing off the disk entirely.
            media.write_bytes(write_media(root, "other.png", width=64, height=48).read_bytes())
            self.assertEqual(
                media_dimensions(media, "image", stat.st_mtime_ns, stat.st_size),
                (800, 600),
            )

            self.assertEqual(_dimensions(media, "image"), (64, 48))


if __name__ == "__main__":
    unittest.main()
