from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from pathlib import Path
from unittest.mock import patch

import gif_to_mp4
from constants import EDIT_TEMP_SUFFIX, GIF_MP4_FRAME_RATE
from testing_fixtures import TempMediaFolder, write_gif

SOURCE = Path("loop.gif")
DESTINATION = Path("loop.mp4.edit-tmp")


def command_for(frame_rate: float = GIF_MP4_FRAME_RATE) -> list[str]:
    return gif_to_mp4.build_gif_to_mp4_command(
        SOURCE, DESTINATION, executable="ffmpeg", frame_rate=frame_rate
    )


def flag_value(command: list[str], flag: str) -> str:
    return command[command.index(flag) + 1]


def encode_into(command, **_kwargs) -> None:
    Path(command[-1]).write_bytes(b"encoded-bytes")


class TargetNameTests(unittest.TestCase):
    def test_the_mp4_takes_the_gif_stem_in_the_same_folder(self) -> None:
        target = gif_to_mp4.mp4_target_for(Path("/datasets/sample/loop.gif"))

        self.assertEqual(target, Path("/datasets/sample/loop.mp4"))

    def test_only_the_final_suffix_is_replaced(self) -> None:
        target = gif_to_mp4.mp4_target_for(Path("/datasets/sample/loop.v2.gif"))

        self.assertEqual(target.name, "loop.v2.mp4")


class ConvertStateTests(unittest.TestCase):
    def test_a_folder_without_the_mp4_reports_the_name_it_would_take(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            state = gif_to_mp4.read_gif_to_mp4_state(media)

            self.assertEqual(state.path, str(media))
            self.assertEqual(state.target, str(root / "loop.mp4"))
            self.assertFalse(state.target_exists)

    def test_an_mp4_already_holding_the_name_is_reported(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            (root / "loop.mp4").write_bytes(b"existing")

            self.assertTrue(gif_to_mp4.read_gif_to_mp4_state(media).target_exists)


class CommandTests(unittest.TestCase):
    def test_the_rate_is_a_filter_so_the_gifs_own_delays_set_the_duration(self) -> None:
        command = command_for()

        self.assertNotIn("-r", command)
        self.assertTrue(flag_value(command, "-vf").startswith("fps=24."))

    def test_odd_dimensions_are_truncated_for_yuv420p(self) -> None:
        self.assertIn("scale=trunc(iw/2)*2:trunc(ih/2)*2", flag_value(command_for(), "-vf"))

    def test_the_source_is_read_and_the_temp_file_is_written(self) -> None:
        command = command_for()

        self.assertEqual(flag_value(command, "-i"), str(SOURCE))
        self.assertEqual(command[-1], str(DESTINATION))

    def test_the_output_is_browser_playable_h264(self) -> None:
        command = command_for()

        self.assertEqual(flag_value(command, "-c:v"), "libx264")
        self.assertEqual(flag_value(command, "-pix_fmt"), "yuv420p")
        self.assertEqual(flag_value(command, "-movflags"), "+faststart")
        self.assertEqual(flag_value(command, "-f"), "mp4")

    def test_no_audio_stream_is_written(self) -> None:
        self.assertIn("-an", command_for())


class ConvertTests(unittest.TestCase):
    def test_the_encode_lands_beside_the_gif_and_leaves_it_alone(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            original = media.read_bytes()

            with patch("gif_to_mp4.run_ffmpeg", side_effect=encode_into):
                response = gif_to_mp4.convert_gif_to_mp4(media, ffmpeg="ffmpeg")

            target = root / "loop.mp4"
            self.assertEqual(response.path, str(target))
            self.assertEqual(response.size, len(b"encoded-bytes"))
            self.assertEqual(response.frame_rate, GIF_MP4_FRAME_RATE)
            self.assertEqual(target.read_bytes(), b"encoded-bytes")
            self.assertEqual(media.read_bytes(), original)

    def test_a_failed_encode_leaves_an_existing_mp4_untouched(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            target = root / "loop.mp4"
            target.write_bytes(b"previous")

            with (
                patch("gif_to_mp4.run_ffmpeg", side_effect=RuntimeError("Invalid filter")),
                self.assertRaises(RuntimeError),
            ):
                gif_to_mp4.convert_gif_to_mp4(media, ffmpeg="ffmpeg")

            self.assertEqual(target.read_bytes(), b"previous")

    def test_the_temp_file_is_cleaned_up_after_a_failure(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            def half_encode(command, **_kwargs) -> None:
                Path(command[-1]).write_bytes(b"partial")
                raise RuntimeError("ffmpeg failed")

            with (
                patch("gif_to_mp4.run_ffmpeg", side_effect=half_encode),
                self.assertRaises(RuntimeError),
            ):
                gif_to_mp4.convert_gif_to_mp4(media, ffmpeg="ffmpeg")

            leftovers = [entry.name for entry in root.iterdir() if EDIT_TEMP_SUFFIX in entry.name]
            self.assertEqual(leftovers, [])

    def test_a_missing_ffmpeg_is_reported_rather_than_run(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with patch("gif_to_mp4.ffmpeg_path", return_value=None):
                with self.assertRaises(RuntimeError) as raised:
                    gif_to_mp4.convert_gif_to_mp4(media)

            self.assertEqual(str(raised.exception), gif_to_mp4.FFMPEG_MISSING_MESSAGE)


if __name__ == "__main__":
    unittest.main()
