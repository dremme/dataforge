"""Unit tests for in-place video editing.

Nothing here invokes ffmpeg, matching the rest of the backend: the fixtures produce
header-only MP4s that no decoder would accept. What is asserted instead is the argv,
literally, because a wrong flag is a silently wrong render and this is the only thing
standing in front of one.

The even-rounding cases in ``OutputDimensionsTests`` are the same table as
``frontend/src/features/gallery/lib/videoEdit.test.ts``. They have to stay in step: the
panel labels the output from its own copy of this arithmetic, and a drift between the
two would show the user a size the render does not produce.
"""

from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

import video_edit
from constants import VIDEO_EDIT_STALE_SUFFIX, VIDEO_EDIT_TEMP_SUFFIX
from ffmpeg_run import FfmpegCancelled
from schemas import VideoCropRect, VideoEditSpec
from testing_fixtures import TempMediaFolder, write_mp4_video

SOURCE = Path("clip.mp4.bak")
DESTINATION = Path("clip.mp4.edit-tmp")

HEAD = [
    "ffmpeg",
    "-nostdin",
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-y",
]
MAPS = ["-map", "0:v:0", "-map", "0:a:0?"]
VIDEO_CODEC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
AUDIO_REENCODE = ["-c:a", "aac", "-b:a", "192k"]
AUDIO_COPY = ["-c:a", "copy"]
FASTSTART = ["-movflags", "+faststart"]


def command_for(spec: VideoEditSpec, *, muxer: str = "mp4") -> list[str]:
    return video_edit.build_video_edit_command(
        SOURCE, DESTINATION, spec, executable="ffmpeg", muxer=muxer
    )


def even_trunc(value: float) -> int:
    """The Python twin of ``trunc(x/2)*2``, so the table below reads as one thing."""
    return int(value / 2) * 2


class BuildVideoEditCommandTests(unittest.TestCase):
    def test_an_untouched_spec_only_remuxes(self) -> None:
        self.assertEqual(
            command_for(VideoEditSpec()),
            [
                *HEAD,
                "-i",
                str(SOURCE),
                *MAPS,
                *VIDEO_CODEC,
                *AUDIO_COPY,
                *FASTSTART,
                "-f",
                "mp4",
                str(DESTINATION),
            ],
        )

    def test_trim_uses_input_seeking_and_a_duration(self) -> None:
        """As output options these would be measured on the retimed output timeline."""
        command = command_for(VideoEditSpec(trim_start=1.5, trim_end=4.75))

        self.assertEqual(
            command,
            [
                *HEAD,
                "-ss",
                "1.500",
                "-t",
                "3.250",
                "-i",
                str(SOURCE),
                *MAPS,
                *VIDEO_CODEC,
                *AUDIO_REENCODE,
                *FASTSTART,
                "-f",
                "mp4",
                str(DESTINATION),
            ],
        )
        self.assertLess(command.index("-ss"), command.index("-i"))
        self.assertLess(command.index("-t"), command.index("-i"))

    def test_an_open_ended_trim_omits_the_duration(self) -> None:
        command = command_for(VideoEditSpec(trim_start=2.0))

        self.assertIn("-ss", command)
        self.assertNotIn("-t", command)

    def test_a_trim_from_zero_omits_the_seek(self) -> None:
        command = command_for(VideoEditSpec(trim_end=3.0))

        self.assertNotIn("-ss", command)
        self.assertEqual(command[command.index("-t") + 1], "3.000")

    def test_crop_is_expressed_against_the_frame_variables(self) -> None:
        spec = VideoEditSpec(crop=VideoCropRect(x=0.1, y=0.2, width=0.5, height=0.6))

        self.assertEqual(
            command_for(spec)[command_for(spec).index("-vf") + 1],
            "crop=trunc(iw*0.500000/2)*2:trunc(ih*0.600000/2)*2"
            ":trunc(iw*0.100000/2)*2:trunc(ih*0.200000/2)*2",
        )

    def test_scale_truncates_both_axes_the_same_way(self) -> None:
        command = command_for(VideoEditSpec(scale=0.5))

        self.assertEqual(
            command[command.index("-vf") + 1],
            "scale=trunc(iw*0.500000/2)*2:trunc(ih*0.500000/2)*2",
        )

    def test_filters_run_crop_then_scale_then_retime(self) -> None:
        spec = VideoEditSpec(
            crop=VideoCropRect(x=0.0, y=0.25, width=1.0, height=0.5), speed=2.0, scale=0.5
        )
        command = command_for(spec)

        filters = command[command.index("-vf") + 1].split(",")
        self.assertEqual([name.split("=")[0] for name in filters], ["crop", "scale", "setpts"])
        self.assertEqual(filters[-1], "setpts=PTS/2.000000")

    def test_an_identity_spec_carries_no_filters(self) -> None:
        self.assertNotIn("-vf", command_for(VideoEditSpec()))
        self.assertNotIn("-af", command_for(VideoEditSpec()))

    def test_speeding_up_retimes_the_audio_too(self) -> None:
        command = command_for(VideoEditSpec(speed=2.0))

        self.assertEqual(command[command.index("-af") + 1], "atempo=2.000000")
        self.assertIn("-c:a", command)
        self.assertEqual(command[command.index("-c:a") + 1], "aac")

    def test_the_optional_audio_stream_is_always_mapped(self) -> None:
        """There is no ffprobe here to ask whether the source has a track."""
        for spec in (VideoEditSpec(), VideoEditSpec(speed=0.5), VideoEditSpec(scale=0.25)):
            with self.subTest(spec=spec):
                self.assertIn("0:a:0?", command_for(spec))

    def test_audio_is_copied_only_when_nothing_disturbs_it(self) -> None:
        cropped = command_for(VideoEditSpec(crop=VideoCropRect(width=0.5)))
        trimmed = command_for(VideoEditSpec(trim_end=2.0))

        self.assertEqual(cropped[cropped.index("-c:a") + 1], "copy")
        self.assertEqual(trimmed[trimmed.index("-c:a") + 1], "aac")

    def test_faststart_is_only_for_the_mp4_family(self) -> None:
        for muxer, expected in (("mp4", True), ("mov", True), ("matroska", False)):
            with self.subTest(muxer=muxer):
                command = command_for(VideoEditSpec(), muxer=muxer)
                self.assertEqual("-movflags" in command, expected)
                self.assertEqual(command[command.index("-f") + 1], muxer)

    def test_the_muxer_is_named_because_the_temp_file_has_no_media_suffix(self) -> None:
        command = command_for(VideoEditSpec())

        self.assertEqual(command[-3:], ["-f", "mp4", str(DESTINATION)])


class AtempoChainTests(unittest.TestCase):
    def test_a_single_link_covers_the_documented_range(self) -> None:
        self.assertEqual(video_edit.atempo_chain(1.5), "atempo=1.500000")
        self.assertEqual(video_edit.atempo_chain(0.75), "atempo=0.750000")

    def test_the_extremes_are_expressed_as_two_links(self) -> None:
        self.assertEqual(video_edit.atempo_chain(4.0), "atempo=2.000000,atempo=2.000000")
        self.assertEqual(video_edit.atempo_chain(0.25), "atempo=0.500000,atempo=0.500000")

    def test_an_uneven_factor_keeps_every_link_in_range(self) -> None:
        chain = video_edit.atempo_chain(3.0)

        factors = [float(link.split("=")[1]) for link in chain.split(",")]
        self.assertAlmostEqual(factors[0] * factors[1], 3.0)
        for factor in factors:
            self.assertGreaterEqual(factor, video_edit.MIN_ATEMPO)
            self.assertLessEqual(factor, video_edit.MAX_ATEMPO)

    def test_unchanged_speed_has_no_links(self) -> None:
        self.assertEqual(video_edit.atempo_chain(1.0), "")


class OutputDimensionsTests(unittest.TestCase):
    """Mirrors the frontend table; see this module's docstring."""

    CASES = (
        ((1920, 1080), 1.0, 1.0, 1.0, (1920, 1080)),
        ((1920, 1080), 1.0, 1.0, 0.5, (960, 540)),
        ((1920, 1080), 0.5, 0.5, 1.0, (960, 540)),
        ((1920, 1080), 0.5, 0.5, 0.5, (480, 270)),
        ((1920, 1080), 1.0, 1.0, 0.75, (1440, 810)),
        ((1919, 1081), 1.0, 1.0, 1.0, (1918, 1080)),
        ((1919, 1081), 0.333, 0.333, 1.0, (638, 358)),
        ((640, 480), 1.0, 1.0, 0.25, (160, 120)),
        ((641, 481), 1.0, 1.0, 0.25, (160, 120)),
    )

    def test_even_truncation_matches_the_shared_table(self) -> None:
        for source, crop_w, crop_h, scale, expected in self.CASES:
            with self.subTest(source=source, crop=(crop_w, crop_h), scale=scale):
                cropped_width = even_trunc(source[0] * crop_w)
                cropped_height = even_trunc(source[1] * crop_h)
                self.assertEqual(
                    (even_trunc(cropped_width * scale), even_trunc(cropped_height * scale)),
                    expected,
                )


class SpecHelperTests(unittest.TestCase):
    def test_a_default_spec_is_identity(self) -> None:
        self.assertTrue(video_edit.is_identity_spec(VideoEditSpec()))

    def test_any_single_change_breaks_identity(self) -> None:
        changed = (
            VideoEditSpec(trim_start=0.5),
            VideoEditSpec(trim_end=3.0),
            VideoEditSpec(speed=2.0),
            VideoEditSpec(scale=0.5),
            VideoEditSpec(crop=VideoCropRect(width=0.5)),
        )
        for spec in changed:
            with self.subTest(spec=spec):
                self.assertFalse(video_edit.is_identity_spec(spec))

    def test_expected_output_length_divides_the_kept_span_by_the_speed(self) -> None:
        spec = VideoEditSpec(trim_start=2.0, trim_end=10.0, speed=2.0)

        self.assertEqual(video_edit.expected_output_seconds(spec), 4.0)

    def test_an_open_ended_trim_has_no_predictable_length(self) -> None:
        self.assertIsNone(video_edit.expected_output_seconds(VideoEditSpec()))

    def test_the_backup_is_named_after_the_whole_filename(self) -> None:
        """`with_suffix` would give `clip.bak` and collide across containers."""
        self.assertEqual(video_edit.backup_path_for(Path("/data/clip.mp4")).name, "clip.mp4.bak")
        self.assertEqual(video_edit.backup_path_for(Path("/data/clip.mov")).name, "clip.mov.bak")

    def test_the_spec_sidecar_sits_two_suffixes_deep(self) -> None:
        self.assertEqual(video_edit.edit_spec_path(Path("/data/clip.mp4")).name, "clip.edit.json")

    def test_an_uneditable_container_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            video_edit.resolve_muxer(Path("clip.avi"))


class EditSpecSidecarTests(unittest.TestCase):
    def test_a_written_spec_reads_back_unchanged(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            spec = VideoEditSpec(
                trim_start=1.0,
                trim_end=5.0,
                speed=2.0,
                scale=0.5,
                crop=VideoCropRect(x=0.1, y=0.1, width=0.8, height=0.8),
            )

            video_edit.write_edit_spec(media, spec)

            self.assertEqual(video_edit.read_edit_spec(media), spec)

    def test_an_unedited_file_has_no_spec(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(video_edit.read_edit_spec(write_mp4_video(root, "clip.mp4")))

    def test_an_unreadable_spec_is_ignored_rather_than_raised(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            video_edit.edit_spec_path(media).write_text("{not json", encoding="utf-8")

            with self.assertLogs(video_edit.logger, level="WARNING"):
                self.assertIsNone(video_edit.read_edit_spec(media))


class EnsureBackupTests(unittest.TestCase):
    def test_the_first_edit_stores_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            backup = video_edit.ensure_backup(media)

            self.assertEqual(backup.name, "clip.mp4.bak")
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(media.read_bytes(), original)

    def test_an_existing_backup_is_never_rewritten(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = video_edit.backup_path_for(media)
            backup.write_bytes(b"the-real-original")

            video_edit.ensure_backup(media)

            self.assertEqual(backup.read_bytes(), b"the-real-original")

    def test_a_failed_copy_leaves_no_partial_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.shutil.copy2", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    video_edit.ensure_backup(media)

            self.assertFalse(video_edit.backup_path_for(media).exists())
            self.assertEqual(list(root.glob("*-tmp")), [])


class ApplyVideoEditTests(unittest.TestCase):
    """The runner is replaced; what is checked is what it was asked to do."""

    def _render(self, content: bytes = b"rendered"):
        def run(command, **_kwargs):
            Path(command[-1]).write_bytes(content)

        return run

    def test_the_render_reads_the_backup_and_publishes_over_the_original(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            captured: list[list[str]] = []

            def run(command, **kwargs):
                captured.append(command)
                self._render()(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                result = video_edit.apply_video_edit(
                    media, VideoEditSpec(speed=2.0), ffmpeg="ffmpeg"
                )

            command = captured[0]
            self.assertEqual(command[command.index("-i") + 1], str(root / "clip.mp4.bak"))
            self.assertEqual(command[-1], str(root / f"clip.mp4{VIDEO_EDIT_TEMP_SUFFIX}"))
            self.assertEqual(media.read_bytes(), b"rendered")
            self.assertTrue(result.has_backup)
            self.assertEqual(result.path, str(media))

    def test_a_second_edit_still_starts_from_the_untouched_original(self) -> None:
        """The whole of "changes are taken from the backup", as one assertion."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            video_edit.backup_path_for(media).write_bytes(b"pristine-original")
            captured: list[list[str]] = []

            def run(command, **kwargs):
                captured.append(command)
                self._render(b"second-render")(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, VideoEditSpec(speed=2.0), ffmpeg="ffmpeg")
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(video_edit.backup_path_for(media).read_bytes(), b"pristine-original")
            for command in captured:
                self.assertEqual(command[command.index("-i") + 1], str(root / "clip.mp4.bak"))

    def test_the_applied_spec_is_stored_beside_the_file(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            spec = VideoEditSpec(trim_start=1.0, trim_end=4.0, scale=0.5)

            with patch("video_edit.run_ffmpeg", side_effect=self._render()):
                video_edit.apply_video_edit(media, spec, ffmpeg="ffmpeg")

            self.assertEqual(video_edit.read_edit_spec(media), spec)

    def test_the_temp_file_never_carries_a_media_suffix(self) -> None:
        """One that did would surface as a phantom gallery item mid-render."""
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            seen: list[str] = []

            def run(command, **kwargs):
                seen.append(Path(command[-1]).suffix)
                self._render()(command, **kwargs)

            with patch("video_edit.run_ffmpeg", side_effect=run):
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(seen, [VIDEO_EDIT_TEMP_SUFFIX])
            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_TEMP_SUFFIX}")), [])

    def test_a_failed_render_leaves_the_file_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            with patch("video_edit.run_ffmpeg", side_effect=RuntimeError("bad filter")):
                with self.assertRaises(RuntimeError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_TEMP_SUFFIX}")), [])
            self.assertIsNone(video_edit.read_edit_spec(media))

    def test_a_failed_render_keeps_the_backup_it_just_made(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.run_ffmpeg", side_effect=RuntimeError("bad filter")):
                with self.assertRaises(RuntimeError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertTrue(video_edit.backup_path_for(media).is_file())

    def test_a_cancelled_render_leaves_nothing_behind(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            original = media.read_bytes()

            def run(command, **_kwargs):
                Path(command[-1]).write_bytes(b"partial")
                raise FfmpegCancelled

            with patch("video_edit.run_ffmpeg", side_effect=run):
                with self.assertRaises(FfmpegCancelled):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(media.read_bytes(), original)
            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_TEMP_SUFFIX}")), [])

    def test_leftovers_from_a_hard_kill_are_swept_first(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            (root / f"other.mp4{VIDEO_EDIT_TEMP_SUFFIX}").write_bytes(b"junk")
            (root / f"other.mp4{VIDEO_EDIT_STALE_SUFFIX}").write_bytes(b"junk")

            with patch("video_edit.run_ffmpeg", side_effect=self._render()):
                video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_TEMP_SUFFIX}")), [])
            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_STALE_SUFFIX}")), [])

    def test_a_missing_ffmpeg_is_reported_rather_than_guessed_at(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with patch("video_edit.ffmpeg_path", return_value=None):
                with self.assertRaises(RuntimeError) as caught:
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5))

            self.assertEqual(str(caught.exception), video_edit.FFMPEG_MISSING_MESSAGE)

    def test_an_uneditable_container_never_reaches_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            media = root / "clip.avi"
            media.write_bytes(b"not-really-an-avi")

            with patch("video_edit.run_ffmpeg") as runner:
                with self.assertRaises(ValueError):
                    video_edit.apply_video_edit(media, VideoEditSpec(scale=0.5), ffmpeg="ffmpeg")

            runner.assert_not_called()


class RevertVideoEditTests(unittest.TestCase):
    def test_the_original_comes_back_and_both_sidecars_go(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            video_edit.backup_path_for(media).write_bytes(b"pristine-original")
            video_edit.write_edit_spec(media, VideoEditSpec(scale=0.5))

            result = video_edit.revert_video_edit(media)

            self.assertEqual(media.read_bytes(), b"pristine-original")
            self.assertFalse(video_edit.backup_path_for(media).exists())
            self.assertFalse(video_edit.edit_spec_path(media).exists())
            self.assertFalse(result.has_backup)

    def test_reverting_without_a_backup_is_rejected(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            with self.assertRaises(ValueError):
                video_edit.revert_video_edit(media)

    def test_a_failed_install_keeps_the_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")
            backup = video_edit.backup_path_for(media)
            backup.write_bytes(b"pristine-original")

            with patch("video_edit.publish_replacing", side_effect=OSError("denied")):
                with self.assertRaises(OSError):
                    video_edit.revert_video_edit(media)

            self.assertEqual(backup.read_bytes(), b"pristine-original")
            self.assertEqual(list(root.glob(f"*{VIDEO_EDIT_TEMP_SUFFIX}")), [])


if __name__ == "__main__":
    unittest.main()
