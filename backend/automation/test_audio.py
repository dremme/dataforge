"""Unit tests for pulling a clip's audio track out with ffmpeg."""

from __future__ import annotations

import subprocess
from pathlib import Path

from testing_fixtures import isolate_test_database

isolate_test_database()

import unittest
from unittest.mock import patch

from automation.audio import (
    AUDIO_MAX_SECONDS,
    AUDIO_SAMPLE_RATE,
    MIN_WAV_BYTES,
    extract_audio_wav,
)
from testing_fixtures import TempMediaFolder, write_gif, write_media, write_mp4_video

WAV_BYTES = b"RIFF" + b"\x00" * MIN_WAV_BYTES


def _completed(returncode: int = 0, stderr: bytes = b"") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=b"", stderr=stderr)


def _writes(payload: bytes, returncode: int = 0):
    """Stand in for ffmpeg by writing ``payload`` to the output path it was given."""

    def run(command, **_kwargs):
        Path(command[-1]).write_bytes(payload)
        return _completed(returncode)

    return run


class ExtractAudioTests(unittest.TestCase):
    def test_returns_the_extracted_bytes(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run", side_effect=_writes(WAV_BYTES)),
            ):
                self.assertEqual(extract_audio_wav(video), WAV_BYTES)

    def test_decodes_one_short_mono_track(self) -> None:
        """The cap and the resample are what keep the request tractable."""
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch(
                    "automation.audio.subprocess.run", side_effect=_writes(WAV_BYTES)
                ) as run_ffmpeg,
            ):
                extract_audio_wav(video)

            command = run_ffmpeg.call_args.args[0]
            self.assertEqual(command[0], "ffmpeg")
            # Selecting the audio stream explicitly is also the silence detector: a
            # file without one fails the command instead of yielding an empty track.
            self.assertIn("-map", command)
            self.assertEqual(command[command.index("-map") + 1], "0:a:0")
            self.assertEqual(command[command.index("-t") + 1], str(AUDIO_MAX_SECONDS))
            self.assertEqual(command[command.index("-ar") + 1], str(AUDIO_SAMPLE_RATE))
            self.assertEqual(command[command.index("-ac") + 1], "1")
            self.assertEqual(command[command.index("-c:a") + 1], "pcm_s16le")
            self.assertEqual(command[command.index("-f") + 1], "wav")
            self.assertIn("-vn", command)
            self.assertIn(str(video), command)
            self.assertEqual(run_ffmpeg.call_args.kwargs.get("check"), False)

    def test_writes_outside_the_dataset_folder(self) -> None:
        """A job must never leave working files next to the user's media."""
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")
            before = {path.name for path in root.iterdir()}

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch(
                    "automation.audio.subprocess.run", side_effect=_writes(WAV_BYTES)
                ) as run_ffmpeg,
            ):
                extract_audio_wav(video)

            destination = Path(run_ffmpeg.call_args.args[0][-1])
            self.assertNotEqual(destination.parent, root)
            self.assertFalse(destination.exists())
            self.assertEqual({path.name for path in root.iterdir()}, before)

    def test_returns_none_without_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value=None),
                patch("automation.audio.subprocess.run") as run_ffmpeg,
            ):
                self.assertIsNone(extract_audio_wav(video))

            run_ffmpeg.assert_not_called()

    def test_returns_none_when_the_clip_has_no_audio_stream(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch(
                    "automation.audio.subprocess.run",
                    return_value=_completed(1, b"Stream map '0:a:0' matches no streams."),
                ),
            ):
                self.assertIsNone(extract_audio_wav(video))

    def test_returns_none_on_an_empty_output(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run", side_effect=_writes(b"RIFF")),
            ):
                self.assertIsNone(extract_audio_wav(video))

    def test_returns_none_when_ffmpeg_never_wrote_anything(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run", return_value=_completed(0)),
            ):
                self.assertIsNone(extract_audio_wav(video))

    def test_returns_none_on_a_timeout(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch(
                    "automation.audio.subprocess.run",
                    side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=60),
                ),
            ):
                self.assertIsNone(extract_audio_wav(video))

    def test_returns_none_when_ffmpeg_cannot_be_launched(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run", side_effect=OSError("not executable")),
            ):
                self.assertIsNone(extract_audio_wav(video))

    def test_a_gif_is_known_silent_without_a_decode(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run") as run_ffmpeg,
            ):
                self.assertIsNone(extract_audio_wav(media))

            run_ffmpeg.assert_not_called()

    def test_a_still_is_never_probed(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")

            with (
                patch("automation.audio.ffmpeg_path", return_value="ffmpeg"),
                patch("automation.audio.subprocess.run") as run_ffmpeg,
            ):
                self.assertIsNone(extract_audio_wav(media))

            run_ffmpeg.assert_not_called()

    def test_an_explicit_ffmpeg_wins_over_the_resolver(self) -> None:
        with TempMediaFolder() as root:
            video = write_mp4_video(root, "clip.mp4")

            with (
                patch("automation.audio.ffmpeg_path", return_value=None),
                patch(
                    "automation.audio.subprocess.run", side_effect=_writes(WAV_BYTES)
                ) as run_ffmpeg,
            ):
                self.assertEqual(extract_audio_wav(video, ffmpeg="/opt/ffmpeg"), WAV_BYTES)

            self.assertEqual(run_ffmpeg.call_args.args[0][0], "/opt/ffmpeg")


if __name__ == "__main__":
    unittest.main()
