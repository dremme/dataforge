from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from testing_fixtures import (
    TempMediaFolder,
    make_png_bytes,
    write_gif,
    write_image,
    write_media,
    write_mp4_video,
)
from thumbnails import (
    _video_thumbnail_commands,
    get_or_create_thumbnail,
    get_thumbnail_cache_budget_bytes,
    get_thumbnail_cache_dir,
    prune_thumbnail_cache,
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

            with patch("thumbnails.ffmpeg_path", return_value=None):
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

    def test_gif_thumbnail_uses_pillow_rather_than_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif", frames=8)

            # If a GIF ever reached the video branch this would raise instead.
            with patch("thumbnails.ffmpeg_path", return_value=None):
                thumbnail = get_or_create_thumbnail(media, 200)

            self.assertEqual(thumbnail.suffix, ".webp")
            self.assertGreater(thumbnail.stat().st_size, 0)

    def test_webp_and_bmp_thumbnails_use_pillow_rather_than_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            for name in ("photo.webp", "photo.bmp"):
                with self.subTest(name=name):
                    media = write_image(root, name, width=640, height=480)

                    # Reaching the video branch would raise without ffmpeg.
                    with patch("thumbnails.ffmpeg_path", return_value=None):
                        thumbnail = get_or_create_thumbnail(media, 200)

                    with Image.open(thumbnail) as image:
                        self.assertEqual(image.format, "WEBP")
                        self.assertLessEqual(image.width, 200)

    def test_every_video_container_takes_the_ffmpeg_branch(self) -> None:
        with TempMediaFolder() as root:
            for name in ("clip.mp4", "clip.avi", "clip.mov", "clip.mkv", "clip.wmv", "clip.flv"):
                with self.subTest(name=name):
                    video = write_mp4_video(root, name)

                    with patch("thumbnails.ffmpeg_path", return_value=None):
                        with self.assertRaisesRegex(Exception, "ffmpeg"):
                            get_or_create_thumbnail(video, 200)

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


class ThumbnailCachePruneTests(unittest.TestCase):
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

    def _write_entry(self, name: str, size: int, used_at: float) -> Path:
        path = get_thumbnail_cache_dir() / name[:2] / f"{name}.webp"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00" * size)
        os.utime(path, (used_at, used_at))
        return path

    def test_keeps_everything_while_the_cache_fits(self) -> None:
        kept = self._write_entry("aa" * 8, 100, used_at=1_000)

        self.assertEqual(prune_thumbnail_cache(budget_bytes=1000), 0)
        self.assertTrue(kept.is_file())

    def test_evicts_least_recently_used_until_the_budget_is_met(self) -> None:
        oldest = self._write_entry("aa" * 8, 100, used_at=1_000)
        middle = self._write_entry("bb" * 8, 100, used_at=2_000)
        newest = self._write_entry("cc" * 8, 100, used_at=3_000)

        reclaimed = prune_thumbnail_cache(budget_bytes=150)

        self.assertEqual(reclaimed, 200)
        self.assertFalse(oldest.is_file())
        self.assertFalse(middle.is_file())
        self.assertTrue(newest.is_file())

    def test_a_budget_of_zero_turns_pruning_off(self) -> None:
        """An explicit 0 means "never delete my thumbnails", not "delete them all"."""
        kept = self._write_entry("aa" * 8, 100, used_at=1_000)

        self.assertEqual(prune_thumbnail_cache(budget_bytes=0), 0)
        self.assertTrue(kept.is_file())

    def test_pruning_an_empty_cache_is_harmless(self) -> None:
        self.assertEqual(prune_thumbnail_cache(budget_bytes=10), 0)


class ThumbnailCacheBudgetTests(unittest.TestCase):
    def test_defaults_when_unset(self) -> None:
        with patch.dict("os.environ", {}, clear=False):
            os.environ.pop("DATAFORGE_THUMBNAIL_CACHE_MAX_MB", None)
            self.assertEqual(get_thumbnail_cache_budget_bytes(), 2048 * 1024 * 1024)

    def test_reads_the_environment_override(self) -> None:
        with patch.dict("os.environ", {"DATAFORGE_THUMBNAIL_CACHE_MAX_MB": "64"}):
            self.assertEqual(get_thumbnail_cache_budget_bytes(), 64 * 1024 * 1024)

    def test_an_unusable_value_falls_back_to_the_default(self) -> None:
        with patch.dict("os.environ", {"DATAFORGE_THUMBNAIL_CACHE_MAX_MB": "lots"}):
            self.assertEqual(get_thumbnail_cache_budget_bytes(), 2048 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
