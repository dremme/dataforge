from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

from color_adjust import adjust_pixels
from color_auto import (
    NothingToAnalyseError,
    image_analysis_pixels,
    suggest_adjust,
    video_analysis_pixels,
)
from ffmpeg_bin import ffmpeg_path
from schemas import ColorAdjust, EditCropRect, MaskRegion


def scene(seed: int = 7, size: int = 96) -> np.ndarray:
    """A believable frame: soft gradients, grey surfaces and a few colors, full tonal range."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size] / size
    grey = 0.98 * (0.6 * x + 0.4 * y)
    rgb = np.repeat(grey[..., None], 3, axis=-1)
    rgb[: size // 2, : size // 2] *= [1.0, 0.45, 0.25]
    rgb[-size // 3 :, -size // 2 :] *= [0.3, 0.6, 0.95]
    return np.clip(rgb + rng.normal(0, 0.01, rgb.shape), 0, 1)


def suggest(rgb: np.ndarray) -> ColorAdjust:
    pixels = rgb.reshape(-1, 3)
    return suggest_adjust(pixels, np.ones(len(pixels)))


def magnitude(adjust: ColorAdjust) -> float:
    return sum(abs(value) for value in adjust.model_dump().values())


class SuggestionTests(unittest.TestCase):
    def test_a_balanced_frame_needs_almost_nothing(self) -> None:
        self.assertLess(magnitude(suggest(scene())), 0.25)

    def test_an_underexposed_frame_is_brightened(self) -> None:
        self.assertGreater(suggest(scene() * 0.45).exposure, 0.1)

    def test_an_overexposed_frame_is_darkened(self) -> None:
        bright = 1 - (1 - scene()) * 0.35
        self.assertLess(suggest(bright).exposure, -0.05)

    def test_haze_gets_a_black_point(self) -> None:
        self.assertGreater(suggest(0.3 + scene() * 0.65).black_point, 0.2)

    def test_a_blue_cast_is_warmed(self) -> None:
        cast = np.clip(scene() * [0.85, 0.95, 1.15], 0, 1)
        self.assertGreater(suggest(cast).warmth, 0.05)

    def test_a_green_cast_is_tinted_toward_magenta(self) -> None:
        cast = np.clip(scene() * [0.92, 1.1, 0.92], 0, 1)
        self.assertGreater(suggest(cast).tint, 0.05)

    def test_a_warm_scene_is_barely_cooled(self) -> None:
        warm = np.clip(scene() * [1.15, 1.0, 0.8], 0, 1)
        self.assertGreaterEqual(suggest(warm).warmth, -0.1)

    def test_a_dull_frame_gets_vibrance(self) -> None:
        grey = scene().mean(axis=-1, keepdims=True)
        dull = grey + (scene() - grey) * 0.2
        self.assertGreater(suggest(dull).vibrance, 0.1)

    def test_the_wand_on_its_own_result_suggests_less(self) -> None:
        for label, faulty in (
            ("dark", scene() * 0.6),
            ("hazy", 0.2 + scene() * 0.75),
            ("blue", np.clip(scene() * [0.88, 0.96, 1.12], 0, 1)),
        ):
            with self.subTest(label):
                first = suggest(faulty)
                second = suggest(adjust_pixels(faulty.reshape(-1, 3), first).reshape(faulty.shape))

                self.assertLess(magnitude(second), magnitude(first))

    def test_weights_decide_which_pixels_count(self) -> None:
        dark = np.full((50, 3), 0.02)
        mid = np.repeat(np.linspace(0.02, 0.98, 50)[:, None], 3, axis=1)
        pixels = np.concatenate([dark, mid])
        only_mid = np.concatenate([np.zeros(50), np.ones(50)])

        self.assertEqual(suggest_adjust(pixels, only_mid), suggest_adjust(mid, np.ones(50)))
        self.assertGreater(
            suggest_adjust(pixels, np.ones(100)).exposure, suggest_adjust(mid, np.ones(50)).exposure
        )

    def test_nothing_left_to_read_is_refused(self) -> None:
        with self.assertRaises(NothingToAnalyseError):
            suggest_adjust(np.zeros((4, 3)), np.zeros(4))


class ImageAnalysisTests(unittest.TestCase):
    def write(self, folder: Path, rgb: np.ndarray) -> Path:
        path = folder / "frame.png"
        Image.fromarray(np.round(rgb * 255).astype(np.uint8)).save(path)
        return path

    def test_the_crop_decides_what_is_read(self) -> None:
        frame = np.concatenate([np.full((40, 40, 3), 0.05), np.full((40, 40, 3), 0.6)], axis=1)
        with TemporaryDirectory() as folder:
            path = self.write(Path(folder), frame)
            dark, _ = image_analysis_pixels(path, [], EditCropRect(x=0.0, width=0.5))
            bright, _ = image_analysis_pixels(path, [], EditCropRect(x=0.5, width=0.5))

        self.assertLess(float(dark.mean()), 0.1)
        self.assertGreater(float(bright.mean()), 0.5)

    def test_masked_regions_count_for_nothing(self) -> None:
        frame = np.full((40, 80, 3), 0.5)
        frame[:, :40] = 0.0
        with TemporaryDirectory() as folder:
            path = self.write(Path(folder), frame)
            pixels, weights = image_analysis_pixels(
                path, [MaskRegion(x=0.0, y=0.0, width=0.5, height=1.0, mode="blackout")], None
            )

        self.assertGreater(float(pixels[weights > 0].min()), 0.4)

    def test_transparent_pixels_count_for_nothing(self) -> None:
        rgba = np.zeros((20, 20, 4))
        rgba[:, :10] = [0.5, 0.5, 0.5, 1.0]
        with TemporaryDirectory() as folder:
            path = self.write(Path(folder), rgba)
            pixels, weights = image_analysis_pixels(path, [], None)

        self.assertAlmostEqual(float(weights.sum()), 200.0, delta=1.0)
        self.assertGreater(float(pixels[weights > 0].min()), 0.45)


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class VideoAnalysisTests(unittest.TestCase):
    def test_only_frames_inside_the_trim_are_read(self) -> None:
        executable = ffmpeg_path()
        assert executable is not None
        with TemporaryDirectory() as folder:
            clip = Path(folder) / "clip.mp4"
            subprocess.run(
                [
                    executable,
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=0x101010:s=64x48:r=10:d=2[a];color=c=0xd0d0d0:s=64x48:r=10:d=2[b];"
                    "[a][b]concat=n=2:v=1",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(clip),
                ],
                check=True,
            )

            dark, _ = video_analysis_pixels(clip, [], None, start=0.0, end=1.8, duration=4.0)
            bright, _ = video_analysis_pixels(clip, [], None, start=2.2, end=None, duration=4.0)

        self.assertLess(float(dark.mean()), 0.15)
        self.assertGreater(float(bright.mean()), 0.7)


if __name__ == "__main__":
    unittest.main()
