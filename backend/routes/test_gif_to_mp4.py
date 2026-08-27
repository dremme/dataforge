from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from ffmpeg_run import FfmpegCancelled
from routes._test_client import client
from testing_fixtures import TempMediaFolder, write_gif, write_media, write_mp4_video

CONVERT_URL = "/api/media/gif-to-mp4"


def convert_url(media: Path, **params: str) -> str:
    query = "&".join(f"{key}={quote(value)}" for key, value in params.items())
    base = f"{CONVERT_URL}?path={quote(str(media))}"
    return f"{base}&{query}" if query else base


def encode_into(command, **_kwargs) -> None:
    Path(command[-1]).write_bytes(b"encoded-bytes")


class GifToMp4StateTests(unittest.TestCase):
    def test_a_gif_reports_the_mp4_it_would_write(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            response = client.get(convert_url(media))

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(media))
            self.assertEqual(payload["target"], str(root / "loop.mp4"))
            self.assertFalse(payload["target_exists"])

    def test_an_mp4_already_beside_the_gif_is_reported(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            write_mp4_video(root, "loop.mp4")

            self.assertTrue(client.get(convert_url(media)).json()["target_exists"])

    def test_a_missing_file_is_a_404(self) -> None:
        with TempMediaFolder() as root:
            self.assertEqual(client.get(convert_url(root / "missing.gif")).status_code, 404)

    def test_a_still_image_is_a_400(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "sunset.png")

            self.assertEqual(client.get(convert_url(media)).status_code, 400)


class ConvertGifTests(unittest.TestCase):
    def test_the_mp4_is_written_beside_the_gif(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with patch("gif_to_mp4.run_ffmpeg", side_effect=encode_into):
                response = client.post(convert_url(media))

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["path"], str(root / "loop.mp4"))
            self.assertEqual(payload["frame_rate"], 24.0)
            self.assertEqual((root / "loop.mp4").read_bytes(), b"encoded-bytes")

    def test_an_existing_mp4_is_refused_rather_than_replaced(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            target = root / "loop.mp4"
            target.write_bytes(b"previous")

            with patch("gif_to_mp4.run_ffmpeg", side_effect=encode_into) as runner:
                response = client.post(convert_url(media))

            self.assertEqual(response.status_code, 409)
            self.assertIn("loop.mp4", response.json()["detail"])
            runner.assert_not_called()
            self.assertEqual(target.read_bytes(), b"previous")

    def test_an_existing_mp4_is_replaced_once_overwrite_is_asked_for(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")
            target = root / "loop.mp4"
            target.write_bytes(b"previous")

            with patch("gif_to_mp4.run_ffmpeg", side_effect=encode_into):
                response = client.post(convert_url(media, overwrite="true"))

            self.assertEqual(response.status_code, 200)
            self.assertEqual(target.read_bytes(), b"encoded-bytes")

    def test_a_video_cannot_be_converted(self) -> None:
        with TempMediaFolder() as root:
            media = write_mp4_video(root, "clip.mp4")

            self.assertEqual(client.post(convert_url(media)).status_code, 400)

    def test_a_missing_ffmpeg_is_a_503(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with patch("gif_to_mp4.ffmpeg_path", return_value=None):
                response = client.post(convert_url(media))

            self.assertEqual(response.status_code, 503)

    def test_an_ffmpeg_failure_surfaces_its_own_message(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with patch("gif_to_mp4.run_ffmpeg", side_effect=RuntimeError("Invalid filter")):
                response = client.post(convert_url(media))

            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.json()["detail"], "Invalid filter")

    def test_a_cancelled_encode_answers_409(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, "loop.gif")

            with patch("gif_to_mp4.run_ffmpeg", side_effect=FfmpegCancelled):
                response = client.post(convert_url(media))

            self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
