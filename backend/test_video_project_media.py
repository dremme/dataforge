from __future__ import annotations

import struct
import unittest
import wave
from pathlib import Path

from PIL import Image

from ffmpeg_bin import ffmpeg_path
from testing_fixtures import CacheFolderTestCase, TempMediaFolder
from video_project_media import WAVEFORM_HEIGHT, waveform


def write_left_only(root: Path, seconds: float) -> Path:
    """Stereo: a loud square wave on the left, silence on the right."""
    media = root / "left.wav"
    rate = 8000
    loud, quiet = struct.pack("<h", 12000), struct.pack("<h", -12000)
    silent = struct.pack("<h", 0)
    frames = b"".join(
        (loud if (index // 8) % 2 == 0 else quiet) + silent
        for index in range(round(rate * seconds))
    )
    with wave.open(str(media), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(frames)
    return media


def drawn(image: Image.Image, box: tuple[int, int, int, int]) -> bool:
    """Whether any of ``box`` is painted; the wave is white on a clear ground."""
    return image.convert("RGBA").getchannel("A").crop(box).getbbox() is not None


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not available")
class WaveformTileTests(CacheFolderTestCase):
    def test_each_channel_has_its_own_lane(self) -> None:
        with TempMediaFolder() as root:
            media = write_left_only(root, seconds=2)

            # Asked at the pixel size the timeline draws it, so the browser never stretches it.
            tile = waveform(ffmpeg_path() or "", media, 0.5, 1.0, 128, 34)

            with Image.open(tile) as image:
                self.assertEqual(image.size, (128, 34))
                self.assertTrue(drawn(image, (0, 0, 128, 17)))
                self.assertFalse(drawn(image, (0, 19, 128, 34)))

    def test_a_stretch_past_the_end_keeps_its_scale_and_is_silent_there(self) -> None:
        with TempMediaFolder() as root:
            media = write_left_only(root, seconds=1)

            # One second of a file that holds half a second from here: the left half only.
            tile = waveform(ffmpeg_path() or "", media, 0.5, 1.0, 128)

            with Image.open(tile) as image:
                self.assertTrue(drawn(image, (4, 0, 60, WAVEFORM_HEIGHT)))
                self.assertFalse(drawn(image, (70, 0, 128, WAVEFORM_HEIGHT)))


if __name__ == "__main__":
    unittest.main()
