from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

import ffmpeg_bin

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_ffmpeg", ROOT / "scripts" / "check_ffmpeg.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load the FFmpeg verification script")
check_ffmpeg = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = check_ffmpeg
spec.loader.exec_module(check_ffmpeg)


class CiFfmpegTests(unittest.TestCase):
    def test_e2e_pins_ffmpeg_7_1_and_checks_the_application_binary_before_tests(self) -> None:
        workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "checks.yml").read_text())
        job = workflow["jobs"]["e2e"]
        version = workflow["env"]["FFMPEG_VERSION"]
        self.assertRegex(version, r"^7\.1\.\d+$")
        self.assertEqual(tuple(map(int, version.split(".")[:2])), ffmpeg_bin.PINNED_VERSION)
        commands = [step.get("run", "") for step in job["steps"]]
        verification = next(
            index for index, command in enumerate(commands) if "scripts/check_ffmpeg.py" in command
        )
        browser_tests = commands.index("npm run test:e2e")
        self.assertLess(verification, browser_tests)
        self.assertIn('"$FFMPEG_VERSION"', commands[verification])

    def test_backend_and_e2e_use_the_same_pinned_build_before_tests(self) -> None:
        workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "checks.yml").read_text())
        for name in ("backend", "e2e"):
            with self.subTest(job=name):
                job = workflow["jobs"][name]
                self.assertEqual(job["runs-on"], "ubuntu-24.04")
                steps = job["steps"]
                installation = next(
                    index
                    for index, step in enumerate(steps)
                    if step.get("uses") == "./.github/actions/setup-ffmpeg"
                )
                self.assertEqual(
                    steps[installation]["with"],
                    {"version": "${{ env.FFMPEG_VERSION }}", "sha256": "${{ env.FFMPEG_SHA256 }}"},
                )
                verification = next(
                    index
                    for index, step in enumerate(steps)
                    if "scripts/check_ffmpeg.py" in step.get("run", "")
                )
                self.assertLess(installation, verification)


FILTER_LISTING = """Filters:
  T.. = Timeline support
  ------
 ... palettegen        V->V       Find the optimal palette for a given stream.
 T.C drawtext          V->V       Draw text on top of video frames using libfreetype library.
"""


class CheckFfmpegTests(unittest.TestCase):
    def _verify(
        self,
        banner: str,
        expected_version: str | None = "7.1.5",
        filters: str = FILTER_LISTING,
    ) -> str:
        def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            stdout = banner if command[1:] == ["-version"] else filters
            return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

        with (
            patch("ffmpeg_bin.ffmpeg_path", return_value="/tools/ffmpeg"),
            patch("check_ffmpeg.subprocess.run", side_effect=run) as fake,
        ):
            output = check_ffmpeg.verify_ffmpeg(expected_version)
        self.assertEqual(fake.call_args_list[0].args[0], ["/tools/ffmpeg", "-version"])
        return output

    def test_accepts_the_exact_pinned_release_and_reports_the_selected_binary(self) -> None:
        banner = "ffmpeg version 7.1.5 Copyright (c) 2000-2026 the FFmpeg developers"
        self.assertEqual(
            self._verify(banner + "\nconfiguration: --enable-libx264"), f"/tools/ffmpeg\n{banner}"
        )

    def test_accepts_a_tagged_build_of_the_pinned_release(self) -> None:
        self._verify("ffmpeg version n7.1.5-static")

    def test_local_verification_accepts_any_pinned_patch_release(self) -> None:
        for version in ("7.1", "7.1.1", "7.1.5"):
            with self.subTest(version=version):
                self._verify(f"ffmpeg version {version}", None)

    def test_local_verification_rejects_other_release_series(self) -> None:
        for version in ("7.0.2", "7.2", "8.0", "9.0.1", "7.10", "N-118000-g1234abcd"):
            with (
                self.subTest(version=version),
                self.assertRaisesRegex(RuntimeError, r"Expected FFmpeg 7\.1\.x"),
            ):
                self._verify(f"ffmpeg version {version}", None)

    def test_rejects_the_old_linux_wheel_and_any_other_release(self) -> None:
        for version in ("7.0.2-static", "7.1", "7.1.4", "7.1.50", "7.1.5.1", "9.0.1"):
            with (
                self.subTest(version=version),
                self.assertRaisesRegex(
                    RuntimeError, r"Expected FFmpeg 7\.1\.5.*selected /tools/ffmpeg"
                ),
            ):
                self._verify(f"ffmpeg version {version}")

    def test_rejects_an_unversioned_or_empty_banner(self) -> None:
        for banner in ("ffmpeg version N-118000-g1234abcd", ""):
            with self.subTest(banner=banner), self.assertRaises(RuntimeError):
                self._verify(banner)

    def test_rejects_a_build_without_drawtext(self) -> None:
        without = FILTER_LISTING.replace("drawtext", "drawbox")
        with self.assertRaisesRegex(RuntimeError, r"/tools/ffmpeg lacks the drawtext filter"):
            self._verify("ffmpeg version 7.1.5", filters=without)

    def test_reads_filter_names_whatever_the_flag_column_width(self) -> None:
        for row in (" T.C drawtext  V->V  Draw text", " T. drawtext  V->V  Draw text"):
            with self.subTest(row=row):
                self._verify("ffmpeg version 7.1.5", filters=row)

    def test_rejects_a_missing_binary(self) -> None:
        with (
            patch("ffmpeg_bin.ffmpeg_path", return_value=None),
            self.assertRaisesRegex(RuntimeError, "could not locate FFmpeg"),
        ):
            check_ffmpeg.verify_ffmpeg("7.1.5")

    def test_a_nonzero_version_command_is_not_accepted(self) -> None:
        with (
            patch("ffmpeg_bin.ffmpeg_path", return_value="/tools/ffmpeg"),
            patch("check_ffmpeg.subprocess.run", side_effect=subprocess.CalledProcessError(1, [])),
            self.assertRaises(subprocess.CalledProcessError),
        ):
            check_ffmpeg.verify_ffmpeg("7.1.5")


if __name__ == "__main__":
    unittest.main()
