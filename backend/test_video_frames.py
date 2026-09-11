import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

from testing_fixtures import write_gif, write_mp4_video
from video_edit import SourceProbe
from video_frames import media_first_frame, source_frame_rate


class SourceFrameRateTests(unittest.TestCase):
    def test_a_clip_reports_the_rate_the_probe_measured(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = write_mp4_video(Path(temp))

            with patch("video_frames.probe_source", return_value=SourceProbe(frame_rate=29.97)):
                self.assertEqual(source_frame_rate(media), 29.97)

    def test_an_unmeasurable_clip_reports_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = write_mp4_video(Path(temp))

            with patch("video_frames.probe_source", return_value=SourceProbe()):
                self.assertIsNone(source_frame_rate(media))

    def test_a_gif_rate_comes_from_its_frame_delays(self) -> None:
        # cv2 reports 0 fps for most GIFs, so the delays are the only real source.
        with tempfile.TemporaryDirectory() as temp:
            media = write_gif(Path(temp), frames=8, duration_ms=50)

            self.assertEqual(source_frame_rate(media), 20.0)

    def test_a_still_has_no_rate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = Path(temp) / "photo.png"
            Image.new("RGB", (8, 8), "red").save(media)

            self.assertIsNone(source_frame_rate(media))

    def test_an_unreadable_file_has_no_rate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = Path(temp) / "broken.gif"
            media.write_bytes(b"not a gif")

            self.assertIsNone(source_frame_rate(media))


class MediaFirstFrameTests(unittest.TestCase):
    def test_a_still_is_its_own_first_frame(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = Path(temp) / "photo.png"
            Image.new("RGB", (8, 8), "red").save(media)

            frame = media_first_frame(media)

            self.assertIsNotNone(frame)
            self.assertEqual(frame.size, (8, 8))

    def test_a_gif_opens_on_its_first_frame(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = write_gif(Path(temp), frames=4, width=32, height=24)

            frame = media_first_frame(media)

            self.assertIsNotNone(frame)
            self.assertEqual(frame.size, (32, 24))

    def test_an_undecodable_clip_yields_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            media = write_mp4_video(Path(temp))

            self.assertIsNone(media_first_frame(media))


if __name__ == "__main__":
    unittest.main()
