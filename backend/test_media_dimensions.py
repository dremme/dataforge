"""Unit tests for header-only media dimension probing."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest

from caption_cache import clear_caption_cache_for_tests
from media_dimensions import media_dimensions, media_info
from testing_fixtures import (
    TempMediaFolder,
    write_gif,
    write_image,
    write_jpeg,
    write_matroska_video,
    write_media,
    write_mp4_video,
    write_sysprompt,
)


def _stat_args(path):
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size


def _info(path, media_type: str):
    return media_info(path, media_type, *_stat_args(path))


def _dimensions(path, media_type: str):
    return media_dimensions(path, media_type, *_stat_args(path))


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

    def test_returns_none_for_a_container_with_no_reader(self) -> None:
        """An avi, wmv, or flv file is neither boxes nor EBML, so it is not opened."""
        with TempMediaFolder() as root:
            for name in ("clip.avi", "clip.wmv", "clip.flv"):
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


class VideoDurationTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_reads_seconds_from_the_media_header(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, sample_count=54, timescale=10, sample_delta=1)

            self.assertEqual(_info(video, "video").duration, 5.4)

    def test_leaves_duration_empty_for_a_still(self) -> None:
        with TempMediaFolder() as root:
            photo = write_media(root, "photo.png")

            self.assertIsNone(_info(photo, "image").duration)

    def test_leaves_duration_empty_for_a_container_with_no_reader(self) -> None:
        with TempMediaFolder() as root:
            disguised = write_mp4_video(
                root, "clip.avi", sample_count=54, timescale=10, sample_delta=1
            )

            self.assertIsNone(_info(disguised, "video").duration)


class MatroskaDimensionTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_reads_the_track_entry(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=1920, height=1080)

            self.assertEqual(_dimensions(video, "video"), (1920, 1080))

    def test_seeks_over_a_cluster_sitting_before_the_tracks(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=1280, height=720, cluster_before_tracks=True)

            self.assertEqual(_dimensions(video, "video"), (1280, 720))

    def test_reads_a_segment_whose_length_is_unknown(self) -> None:
        """What a muxer writes when it streams the file out rather than sizing it."""
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=720, height=1280, unknown_segment_size=True)

            self.assertEqual(_dimensions(video, "video"), (720, 1280))

    def test_skips_the_tracks_that_carry_no_picture(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=800, height=600, audio_track=True)

            self.assertEqual(_dimensions(video, "video"), (800, 600))

    def test_reports_the_largest_picture_track(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=320, height=240, second_video=(1920, 800))

            self.assertEqual(_dimensions(video, "video"), (1920, 800))

    def test_prefers_the_display_size_over_the_coded_one(self) -> None:
        """Anamorphic video: the MP4 path reports `tkhd`, so this reports its twin."""
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=720, height=480, display_size=(853, 480))

            self.assertEqual(_dimensions(video, "video"), (853, 480))

    def test_ignores_a_display_size_that_is_not_in_pixels(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(
                root, width=720, height=480, display_size=(16, 9), display_unit=3
            )

            self.assertEqual(_dimensions(video, "video"), (720, 480))

    def test_returns_none_for_bytes_that_are_not_matroska(self) -> None:
        with TempMediaFolder() as root:
            # MP4 bytes under a matroska name: the suffix picks the reader, and the
            # reader must still refuse a file whose first element is not an EBML header.
            disguised = write_mp4_video(root, "clip.mkv", width=1920, height=1080)

            self.assertIsNone(_dimensions(disguised, "video"))

    def test_returns_none_for_a_truncated_file(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root)
            video.write_bytes(video.read_bytes()[:9])

            self.assertIsNone(_dimensions(video, "video"))


class MatroskaDurationTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_caption_cache_for_tests()

    def test_reads_seconds_from_the_segment_info(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, duration_seconds=5.4)

            self.assertAlmostEqual(_info(video, "video").duration, 5.4)

    def test_scales_the_duration_by_the_timecode_scale(self) -> None:
        """`Duration` counts `TimecodeScale` nanoseconds, not seconds and not ticks."""
        with TempMediaFolder() as root:
            video = write_matroska_video(root, duration_seconds=90.0, timecode_scale=100_000)

            self.assertAlmostEqual(_info(video, "video").duration, 90.0)

    def test_reads_a_32_bit_duration(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, duration_seconds=8.0, duration_width=4)

            self.assertAlmostEqual(_info(video, "video").duration, 8.0)

    def test_leaves_duration_empty_when_the_segment_omits_it(self) -> None:
        with TempMediaFolder() as root:
            video = write_matroska_video(root, width=640, height=360, duration_seconds=None)

            self.assertEqual(_dimensions(video, "video"), (640, 360))
            self.assertIsNone(_info(video, "video").duration)


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
