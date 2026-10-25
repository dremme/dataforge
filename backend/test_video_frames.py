import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image

from testing_fixtures import write_gif, write_mp4_video
from video_frames import media_first_frame


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
