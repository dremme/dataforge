from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import ffmpeg_bin
from ffmpeg_bin import ffmpeg_path, locate_ffmpeg


class FfmpegPathTests(unittest.TestCase):
    def setUp(self) -> None:
        version = patch("ffmpeg_bin._is_pinned", return_value=True)
        version.start()
        self.addCleanup(version.stop)

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
        with patch("ffmpeg_bin.shutil.which", side_effect=[None, "/usr/bin/ffmpeg"]):
            with patch.dict(
                sys.modules, {"imageio_ffmpeg": SimpleNamespace(get_ffmpeg_exe=lambda: "")}
            ):
                self.assertIsNone(ffmpeg_path())
            self.assertEqual(ffmpeg_path(), "/usr/bin/ffmpeg")


class FfmpegVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.on_path = Path(directory.name) / "ffmpeg"
        self.on_path.write_bytes(b"")
        self.bundled = Path(directory.name) / "ffmpeg-bundled"
        self.bundled.write_bytes(b"")
        ffmpeg_bin._ffmpeg_version.cache_clear()
        self.addCleanup(ffmpeg_bin._ffmpeg_version.cache_clear)

    def _locate(self, banner: str, *, bundled: bool = True) -> tuple[str, str] | None:
        wheel = SimpleNamespace(get_ffmpeg_exe=lambda: str(self.bundled) if bundled else "")

        def version(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            output = banner if command[0] == str(self.on_path) else "ffmpeg version 7.1"
            return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

        with (
            patch("ffmpeg_bin.shutil.which", return_value=str(self.on_path)),
            patch("ffmpeg_bin.subprocess.run", side_effect=version) as run,
            patch.dict(sys.modules, {"imageio_ffmpeg": wheel}),
        ):
            location = locate_ffmpeg()
        self.runs = run.call_count
        return location

    def test_an_ffmpeg_older_than_7_1_on_path_yields_to_the_bundled_one(self) -> None:
        banner = "ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/"
        self.assertEqual(self._locate(banner), (str(self.bundled), "bundled"))

    def test_an_old_ffmpeg_on_path_is_rejected_when_no_pinned_bundle_is_available(self) -> None:
        banner = "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023"
        self.assertIsNone(self._locate(banner, bundled=False))

    def test_any_7_1_patch_release_on_path_is_preferred(self) -> None:
        for banner in (
            "ffmpeg version 7.1-essentials_build-www.gyan.dev",
            "ffmpeg version 7.1.5 Copyright (c) 2000-2026",
            "ffmpeg version n7.1.1 Copyright (c) 2000-2025",
        ):
            ffmpeg_bin._ffmpeg_version.cache_clear()
            self.assertEqual(self._locate(banner), (str(self.on_path), "path"), banner)

    def test_a_build_without_a_release_number_cannot_override_a_pinned_bundle(self) -> None:
        banner = "ffmpeg version N-118000-g1234abcd Copyright (c) 2000-2026"
        self.assertEqual(self._locate(banner), (str(self.bundled), "bundled"))

    def test_other_release_series_and_malformed_banners_are_rejected_without_a_bundle(self) -> None:
        for version in (
            "7.0.2",
            "7.2",
            "7.10",
            "8.0",
            "9.0.1",
            "N-118000-g1234abcd",
            "7.1.5.1",
            "7.1extra",
        ):
            with self.subTest(version=version):
                ffmpeg_bin._ffmpeg_version.cache_clear()
                self.assertIsNone(self._locate(f"ffmpeg version {version}", bundled=False))

    def test_a_version_command_failure_cannot_masquerade_as_the_pinned_release(self) -> None:
        result = subprocess.CompletedProcess([], 1, stdout="ffmpeg version 7.1")
        with patch("ffmpeg_bin.subprocess.run", return_value=result):
            self.assertFalse(ffmpeg_bin._is_pinned(str(self.on_path)))

    def test_an_unreadable_binary_does_not_satisfy_the_pin(self) -> None:
        with patch("ffmpeg_bin.Path.stat", side_effect=OSError):
            self.assertFalse(ffmpeg_bin._is_pinned(str(self.on_path)))

    def test_the_version_is_read_once_per_binary(self) -> None:
        banner = "ffmpeg version 7.1.5"
        self._locate(banner)
        self._locate(banner)
        self.assertEqual(self.runs, 0)

    def test_an_upgraded_binary_is_read_again(self) -> None:
        self._locate("ffmpeg version 7.0.2")
        stat = self.on_path.stat()
        os.utime(self.on_path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        self.assertEqual(self._locate("ffmpeg version 7.1"), (str(self.on_path), "path"))

    def test_a_newer_global_ffmpeg_cannot_override_the_pinned_bundled_release(self) -> None:
        wheel = SimpleNamespace(get_ffmpeg_exe=lambda: str(self.bundled))

        def version(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
            release = "9.0.1" if command[0] == str(self.on_path) else "7.1"
            return subprocess.CompletedProcess(command, 0, stdout=f"ffmpeg version {release}")

        with (
            patch("ffmpeg_bin.shutil.which", return_value=str(self.on_path)),
            patch("ffmpeg_bin.subprocess.run", side_effect=version),
            patch.dict(sys.modules, {"imageio_ffmpeg": wheel}),
        ):
            self.assertEqual(locate_ffmpeg(), (str(self.bundled), "bundled"))

    def test_an_outdated_linux_bundle_cannot_bypass_the_version_pin(self) -> None:
        wheel = SimpleNamespace(get_ffmpeg_exe=lambda: str(self.bundled))
        result = subprocess.CompletedProcess([], 0, stdout="ffmpeg version 7.0.2-static")
        with (
            patch("ffmpeg_bin.shutil.which", return_value=str(self.on_path)),
            patch("ffmpeg_bin.subprocess.run", return_value=result),
            patch.dict(sys.modules, {"imageio_ffmpeg": wheel}),
        ):
            self.assertIsNone(locate_ffmpeg())


if __name__ == "__main__":
    unittest.main()
