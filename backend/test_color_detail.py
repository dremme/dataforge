from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

from color_detail import (
    apply_detail,
    definition_params,
    guided_filter,
    noise_params,
    rgb_to_ycbcr,
    ycbcr_to_rgb,
)
from ffmpeg_bin import ffmpeg_path
from schemas import ColorAdjust


def noisy_step(noise: float = 0.03, seed: int = 4) -> np.ndarray:
    """Two flat halves, a hard edge between them, and grain over both."""
    rng = np.random.default_rng(seed)
    plane = np.full((48, 96), 0.35)
    plane[:, 48:] = 0.7
    return np.clip(plane + rng.normal(0.0, noise, plane.shape), 0.0, 1.0).astype(np.float32)


def textured_grey() -> np.ndarray:
    """Fine mid-grey texture: the local contrast definition is meant to raise."""
    y, x = np.mgrid[0:512, 0:512]
    grey = 0.5 + 0.05 * np.sin(x / 3.0) * np.sin(y / 3.0)
    return np.repeat(grey[..., None], 3, axis=-1).astype(np.float32)


class ColorSpaceTests(unittest.TestCase):
    def test_ycbcr_round_trips(self) -> None:
        rgb = np.random.default_rng(0).random((20, 3)).astype(np.float32)

        np.testing.assert_allclose(ycbcr_to_rgb(rgb_to_ycbcr(rgb)), rgb, atol=1e-6)

    def test_grey_has_neutral_chroma(self) -> None:
        ycc = rgb_to_ycbcr(np.array([[0.4, 0.4, 0.4]], dtype=np.float32))

        np.testing.assert_allclose(ycc, [[0.4, 0.5, 0.5]], atol=1e-6)


class GuidedFilterTests(unittest.TestCase):
    def test_grain_flattens_and_the_edge_stays(self) -> None:
        plane = noisy_step()
        params = noise_params(1.0)

        smoothed = guided_filter(plane, params.luma_radius, params.luma_eps)

        self.assertLess(float(smoothed[:, 5:40].std()), float(plane[:, 5:40].std()) / 2)
        edge = float(smoothed[:, 52:56].mean() - smoothed[:, 40:44].mean())
        self.assertGreater(edge, 0.3)

    def test_a_tiny_eps_changes_almost_nothing(self) -> None:
        plane = noisy_step()

        np.testing.assert_allclose(guided_filter(plane, 2, 1e-9), plane, atol=1e-3)


class DefinitionTests(unittest.TestCase):
    def test_the_base_is_taken_at_a_fixed_short_side(self) -> None:
        params = definition_params(1.0, (1920, 1080))

        self.assertEqual(params.size, (455, 256))
        self.assertAlmostEqual(params.sigma, 3.84)

    def test_a_small_frame_is_blurred_at_its_own_size(self) -> None:
        params = definition_params(1.0, (200, 100))

        self.assertEqual(params.size, (200, 100))
        self.assertAlmostEqual(params.sigma, 3.84 * 100 / 256)

    def test_texture_gains_contrast_and_flat_areas_do_not_move(self) -> None:
        texture = textured_grey()
        flat = np.full((512, 512, 3), 0.5, dtype=np.float32)

        defined = apply_detail(texture, ColorAdjust(definition=1.0))

        self.assertGreater(float(defined[..., 0].std()), float(texture[..., 0].std()) * 1.3)
        np.testing.assert_allclose(apply_detail(flat, ColorAdjust(definition=1.0)), flat, atol=1e-5)


class DetailTests(unittest.TestCase):
    def test_resting_detail_tools_return_the_pixels(self) -> None:
        rgb = np.random.default_rng(3).random((16, 16, 3)).astype(np.float32)

        np.testing.assert_allclose(apply_detail(rgb, ColorAdjust()), rgb, atol=1e-5)

    def test_noise_reduction_clears_color_speckle(self) -> None:
        rng = np.random.default_rng(5)
        base = np.full((48, 48, 3), [0.5, 0.4, 0.3], dtype=np.float32)
        speckled = np.clip(base + rng.normal(0, 0.03, base.shape), 0, 1).astype(np.float32)

        cleaned = apply_detail(speckled, ColorAdjust(noise_reduction=1.0))

        def chroma_noise(rgb: np.ndarray) -> float:
            return float(rgb_to_ycbcr(rgb)[..., 1:].std(axis=(0, 1)).mean())

        self.assertLess(chroma_noise(cleaned), chroma_noise(speckled) / 2)


@unittest.skipUnless(ffmpeg_path(), "ffmpeg is not installed")
class FfmpegParityTests(unittest.TestCase):
    """The video path runs ffmpeg's own filters; these hold them to the numpy definitions."""

    def ffmpeg_gray(self, plane: np.ndarray, filters: str) -> np.ndarray:
        executable = ffmpeg_path()
        assert executable is not None
        with TemporaryDirectory() as folder:
            source = Path(folder) / "in.png"
            output = Path(folder) / "out.png"
            Image.fromarray(np.round(plane * 255).astype(np.uint8)).save(source)
            subprocess.run(
                [executable, "-v", "error", "-y", "-i", str(source), "-vf", filters, str(output)],
                check=True,
            )
            with Image.open(output) as rendered:
                return np.asarray(rendered.convert("L"), dtype=np.float32) / 255.0

    def test_guided_takes_eps_as_a_variance_like_ours(self) -> None:
        plane = noisy_step()
        params = noise_params(0.8)
        quantised = np.round(plane * 255) / 255

        ours = guided_filter(quantised.astype(np.float32), params.luma_radius, params.luma_eps)
        theirs = self.ffmpeg_gray(
            plane,
            f"format=gray16le,guided=radius={params.luma_radius}:eps={params.luma_eps},format=gray",
        )

        self.assertLess(float(np.abs(ours - theirs).max()), 1.5 / 255)


if __name__ == "__main__":
    unittest.main()
