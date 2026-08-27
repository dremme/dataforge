from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import io
import threading
import unittest
from unittest.mock import patch

from PIL import Image

import gif_frames
from gif_frames import (
    GifFrameError,
    GifFrameUnavailableError,
    _walk_to_frame,
    clear_gif_caches_for_tests,
    extract_gif_first_frame,
    extract_gif_frame,
    get_gif_frame_cache_bytes_for_tests,
    gif_frame_count,
    warm_gif_frames,
)
from testing_fixtures import TempMediaFolder, write_gif, write_media, write_mp4_video


class GifFrameCountTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_counts_every_frame(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=24)

            self.assertEqual(gif_frame_count(media), 24)

    def test_reads_a_single_frame_gif(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=1)

            self.assertEqual(gif_frame_count(media), 1)

    def test_returns_none_for_a_file_that_is_not_a_gif(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(gif_frame_count(write_mp4_video(root)))
            self.assertIsNone(gif_frame_count(root / "missing.gif"))
            # Pillow reads a PNG happily; reject on format, not on whether the decode succeeded.
            self.assertIsNone(gif_frame_count(write_media(root)))

    def test_recounts_after_the_file_changes(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=6)
            self.assertEqual(gif_frame_count(media), 6)

            write_gif(root, media.name, frames=14)

            self.assertEqual(gif_frame_count(media), 14)


class ExtractGifFrameTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_returns_jpeg_bytes_for_a_frame_in_range(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=24, width=64, height=48)

            data = extract_gif_frame(media, 7)

            with Image.open(io.BytesIO(data)) as frame:
                self.assertEqual(frame.format, "JPEG")
                self.assertEqual(frame.size, (64, 48))

    def test_reads_the_first_and_last_frames(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            self.assertTrue(extract_gif_frame(media, 0))
            self.assertTrue(extract_gif_frame(media, 11))

    def test_frames_differ_from_one_another(self) -> None:
        # A decoder that never advanced would hand back frame zero every time.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            self.assertNotEqual(extract_gif_frame(media, 0), extract_gif_frame(media, 9))

    def test_rejects_an_index_past_the_end(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=5)

            with self.assertRaises(GifFrameUnavailableError):
                extract_gif_frame(media, 5)

    def test_rejects_a_negative_index(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=5)

            with self.assertRaises(GifFrameUnavailableError):
                extract_gif_frame(media, -1)

    def test_reports_an_unreadable_file(self) -> None:
        with TempMediaFolder() as root:
            broken = root / "broken.gif"
            broken.write_bytes(b"GIF89a not really a gif")

            with self.assertRaises(GifFrameError):
                extract_gif_frame(broken, 0)

    def test_refuses_a_file_that_is_not_a_gif(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaises(GifFrameError):
                extract_gif_frame(write_media(root), 0)

    def test_flattens_transparency_onto_an_opaque_frame(self) -> None:
        with TempMediaFolder() as root:
            media = root / "transparent.gif"
            frames = []
            for index in range(3):
                frame = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
                frame.putpixel((index, index), (255, 0, 0, 255))
                frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))
            frames[0].save(
                media, save_all=True, append_images=frames[1:], duration=100, transparency=0
            )

            with Image.open(io.BytesIO(extract_gif_frame(media, 0))) as frame:
                # JPEG carries no alpha, so the frame must arrive already composited.
                self.assertEqual(frame.mode, "RGB")


class GifFrameCacheTests(unittest.TestCase):
    """GIF frames are deltas, so reading them one at a time replays the file each time."""

    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_a_warmed_frame_matches_the_walked_one_byte_for_byte(self) -> None:
        # Cached strip and fallback walk must not disagree about a single byte.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=16)
            walked = [_walk_to_frame(media, index) for index in (0, 7, 15)]

            self.assertTrue(warm_gif_frames(media))

            self.assertEqual([extract_gif_frame(media, index) for index in (0, 7, 15)], walked)

    def test_a_warmed_gif_is_read_without_touching_the_file_again(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=16)
            self.assertTrue(warm_gif_frames(media))

            with patch("gif_frames.Image.open", side_effect=AssertionError("decoded again")):
                self.assertTrue(extract_gif_frame(media, 9))

    def test_the_first_request_answers_without_waiting_for_the_full_decode(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=16)

            with patch("gif_frames._decode_strip", side_effect=AssertionError("blocked")):
                # The warm runs on its own thread; the request itself must not join it.
                with patch("gif_frames._schedule_warm"):
                    self.assertTrue(extract_gif_frame(media, 3))

    def test_a_rewritten_gif_is_decoded_again(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=6)
            self.assertTrue(warm_gif_frames(media))
            first = extract_gif_frame(media, 5)

            write_gif(root, media.name, frames=6, width=96, height=72)
            warm_gif_frames(media)

            self.assertNotEqual(extract_gif_frame(media, 5), first)

    def test_an_out_of_range_frame_still_fails_from_the_cache(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=5)
            self.assertTrue(warm_gif_frames(media))

            with self.assertRaises(GifFrameUnavailableError):
                extract_gif_frame(media, 5)

    def test_a_gif_too_large_to_cache_falls_back_instead_of_re_decoding(self) -> None:
        # Caching a strip that does not fit would rebuild it on every request.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            with patch("gif_frames.GIF_FRAME_CACHE_BUDGET_BYTES", 1):
                self.assertFalse(warm_gif_frames(media))
                self.assertTrue(extract_gif_frame(media, 6))

                with patch("gif_frames._decode_strip", side_effect=AssertionError("re-decoded")):
                    self.assertTrue(extract_gif_frame(media, 7))

    def test_the_cache_evicts_down_to_its_budget(self) -> None:
        with TempMediaFolder() as root:
            first = write_gif(root, "first.gif", frames=12)
            second = write_gif(root, "second.gif", frames=12)

            self.assertTrue(warm_gif_frames(first))
            resident = get_gif_frame_cache_bytes_for_tests()

            with patch("gif_frames.GIF_FRAME_CACHE_BUDGET_BYTES", resident + 1):
                self.assertTrue(warm_gif_frames(second))

            # Both cannot fit, so the older strip is the one that goes.
            self.assertLessEqual(get_gif_frame_cache_bytes_for_tests(), resident * 2)
            self.assertTrue(extract_gif_frame(first, 3))
            self.assertTrue(extract_gif_frame(second, 3))


class ExtractGifFirstFrameTests(unittest.TestCase):
    """The single frame the captioning jobs describe a GIF from."""

    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_returns_the_opening_frame_as_rgb(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=30)

            frame = extract_gif_first_frame(media)

            assert frame is not None
            self.assertEqual(frame.mode, "RGB")

    def test_returns_the_first_frame_not_a_later_one(self) -> None:
        # The block moves left to right; only the opening frame has it flush against the left edge.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            frame = extract_gif_first_frame(media)

            assert frame is not None
            self.assertEqual(frame.getpixel((0, 4))[:3], (240, 30, 90))

    def test_reads_a_single_frame_gif(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNotNone(extract_gif_first_frame(write_gif(root, frames=1)))

    def test_returns_none_for_an_unreadable_file(self) -> None:
        with TempMediaFolder() as root:
            self.assertIsNone(extract_gif_first_frame(write_media(root)))

    def test_transparency_composites_over_black(self) -> None:
        """A plain ``convert("RGB")`` would emit the transparent palette entry."""
        with TempMediaFolder() as root:
            media = root / "transparent.gif"
            frame = Image.new("P", (16, 16), 0)
            frame.putpalette([255, 255, 255] + [0, 0, 0] * 255)
            frame.save(media, transparency=0)

            extracted = extract_gif_first_frame(media)

            assert extracted is not None
            self.assertEqual(extracted.getpixel((0, 0)), (0, 0, 0))


class GifFileHandleTests(unittest.TestCase):
    """Pillow holds a multi-frame image's file open, which locks it on Windows."""

    def setUp(self) -> None:
        clear_gif_caches_for_tests()

    def test_frame_extraction_leaves_the_gif_movable(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            extract_gif_frame(media, 3)

            media.rename(root / "moved.gif")

    def test_first_frame_extraction_leaves_the_gif_deletable(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            assert extract_gif_first_frame(media) is not None

            media.unlink()
            self.assertFalse(media.exists())

    def test_a_gif_stays_deletable_while_a_background_warm_runs(self) -> None:
        # The warm outlives the request; decoding from the path would lock the GIF on Windows.
        with TempMediaFolder() as root:
            media = write_gif(root, frames=40)

            started = threading.Event()
            release = threading.Event()
            original = gif_frames._encode_jpeg

            def blocking_encode(frame):
                started.set()
                release.wait(5)
                return original(frame)

            with patch("gif_frames._encode_jpeg", side_effect=blocking_encode):
                warm = threading.Thread(target=warm_gif_frames, args=(media,), daemon=True)
                warm.start()
                self.assertTrue(started.wait(5))

                try:
                    media.unlink()
                finally:
                    release.set()
                    warm.join(5)

            self.assertFalse(media.exists())

    def test_counting_frames_leaves_the_gif_deletable(self) -> None:
        with TempMediaFolder() as root:
            media = write_gif(root, frames=12)

            gif_frame_count(media)

            media.unlink()
            self.assertFalse(media.exists())


if __name__ == "__main__":
    unittest.main()
