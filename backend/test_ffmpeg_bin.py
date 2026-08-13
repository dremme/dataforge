"""Unit tests for resolving the ffmpeg executable."""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ffmpeg_bin import ffmpeg_path


class FfmpegPathTests(unittest.TestCase):
    def test_prefers_ffmpeg_on_path(self) -> None:
        with patch("ffmpeg_bin.shutil.which", return_value="/usr/bin/ffmpeg") as which:
            self.assertEqual(ffmpeg_path(), "/usr/bin/ffmpeg")

        which.assert_called_once_with("ffmpeg")

    def test_falls_back_to_the_bundled_binary(self) -> None:
        bundled = SimpleNamespace(get_ffmpeg_exe=lambda: __file__)
        with (
            patch("ffmpeg_bin.shutil.which", return_value=None),
            patch.dict(sys.modules, {"imageio_ffmpeg": bundled}),
        ):
            self.assertEqual(ffmpeg_path(), __file__)

    def test_returns_none_when_the_bundled_path_is_not_a_file(self) -> None:
        bundled = SimpleNamespace(get_ffmpeg_exe=lambda: "/nope/ffmpeg-does-not-exist")
        with (
            patch("ffmpeg_bin.shutil.which", return_value=None),
            patch.dict(sys.modules, {"imageio_ffmpeg": bundled}),
        ):
            self.assertIsNone(ffmpeg_path())

    def test_returns_none_when_the_bundled_lookup_raises(self) -> None:
        def explode() -> str:
            raise RuntimeError("no wheel here")

        bundled = SimpleNamespace(get_ffmpeg_exe=explode)
        with (
            patch("ffmpeg_bin.shutil.which", return_value=None),
            patch.dict(sys.modules, {"imageio_ffmpeg": bundled}),
        ):
            self.assertIsNone(ffmpeg_path())

    def test_is_resolved_per_call_rather_than_cached(self) -> None:
        """An ffmpeg installed while the server runs must be picked up without a restart."""
        with patch("ffmpeg_bin.shutil.which", side_effect=[None, "/usr/bin/ffmpeg"]):
            with patch.dict(
                sys.modules, {"imageio_ffmpeg": SimpleNamespace(get_ffmpeg_exe=lambda: "")}
            ):
                self.assertIsNone(ffmpeg_path())
            self.assertEqual(ffmpeg_path(), "/usr/bin/ffmpeg")


if __name__ == "__main__":
    unittest.main()
