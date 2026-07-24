"""Unit tests for thumbnail generation."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from testing_fixtures import TempMediaFolder, make_png_bytes, write_media, write_mp4_video
from thumbnails import (
    _video_thumbnail_commands,
    get_or_create_thumbnail,
    get_thumbnail_cache_dir,
    legacy_thumbnail_cache_path,
    thumbnail_cache_path,
)


class ThumbnailGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._cache_dir = tempfile.TemporaryDirectory(prefix="dataforge-thumb-cache-")
        self._cache_env = patch.dict(
            "os.environ",
            {"DATAFORGE_THUMBNAIL_CACHE": self._cache_dir.name},
        )
        self._cache_env.start()

    def tearDown(self) -> None:
        self._cache_env.stop()
        self._cache_dir.cleanup()

    def test_generates_webp_thumbnail_for_images(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, width=640, height=480)

            thumbnail = get_or_create_thumbnail(media, 200)

            self.assertTrue(thumbnail.is_file())
            with Image.open(thumbnail) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertLessEqual(image.width, 200)

    def test_reuses_cached_thumbnail_until_source_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, width=320, height=240)
            first = get_or_create_thumbnail(media, 160)
            second = get_or_create_thumbnail(media, 160)

            self.assertEqual(first, second)
            self.assertEqual(first, thumbnail_cache_path(media, 160))

            media.write_bytes(make_png_bytes(width=128, height=96))
            third = get_or_create_thumbnail(media, 160)

            self.assertNotEqual(first, third)

    def test_video_thumbnail_requires_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)

            with patch("thumbnails._ffmpeg_path", return_value=None):
                with self.assertRaisesRegex(Exception, "ffmpeg"):
                    get_or_create_thumbnail(video, 200)

    def test_creates_cache_directory_on_first_thumbnail(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root)
            cache_dir = get_thumbnail_cache_dir()
            if cache_dir.exists():
                for child in cache_dir.rglob("*"):
                    if child.is_file():
                        child.unlink()
                for child in sorted(cache_dir.rglob("*"), reverse=True):
                    if child.is_dir():
                        child.rmdir()

            thumbnail = get_or_create_thumbnail(media, 200)

            self.assertTrue(cache_dir.is_dir())
            self.assertTrue(thumbnail.is_file())
            self.assertEqual(thumbnail, thumbnail_cache_path(media, 200))
            self.assertEqual(thumbnail.parent.parent, cache_dir)

    def test_reads_legacy_flat_cache_entries(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, width=200, height=150)
            # Simulate an old flat-layout .jpg thumbnail (pre-shard + pre-WebP)
            legacy_jpg = legacy_thumbnail_cache_path(media, 180).with_suffix(".jpg")
            legacy_jpg.parent.mkdir(parents=True, exist_ok=True)
            legacy_jpg.write_bytes(b"\xff\xd8" + b"\x00" * 32)

            thumbnail = get_or_create_thumbnail(media, 180)

            self.assertEqual(thumbnail, legacy_jpg)

    def test_video_thumbnail_targets_first_frame(self) -> None:
        commands = _video_thumbnail_commands(
            "ffmpeg",
            Path("clip.mp4"),
            Path("thumb.webp"),
            200,
        )

        self.assertEqual(commands[0][:2], ["-i", "clip.mp4"])
        for command in commands:
            for index, arg in enumerate(command):
                if arg == "-ss":
                    self.assertEqual(command[index + 1], "0", command)

    def test_video_thumbnail_publishes_extracted_frame(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root)

            def _fake_render(_source: Path, destination: Path, _width: int) -> None:
                destination.write_bytes(b"\xff\xd8" + b"\x00" * 64)

            with patch("thumbnails._render_video_thumbnail", side_effect=_fake_render):
                thumbnail = get_or_create_thumbnail(video, 200)

            self.assertTrue(thumbnail.is_file())
            self.assertGreater(thumbnail.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
