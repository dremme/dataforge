from __future__ import annotations

import colorsys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

import color_adjust
from color_adjust import (
    GLOBAL_TOOLS,
    LUMA,
    adjust_lut,
    adjust_pixels,
    fit_gamut,
    lut_filter,
    tone_curve,
    write_cube,
)
from schemas import ColorAdjust

MID_GREY = np.array([0.5, 0.5, 0.5])
LIGHT_GREY = np.array([0.9, 0.9, 0.9])
DARK_GREY = np.array([0.18, 0.18, 0.18])
BRICK = np.array([0.8, 0.3, 0.2])
MUTED = np.array([0.5, 0.45, 0.4])

TONE_TOOLS = tuple(
    tool for tool in GLOBAL_TOOLS if tool not in ("saturation", "vibrance", "warmth", "tint", "hue")
)


def adjusted(color: np.ndarray, **tools: float) -> np.ndarray:
    return adjust_pixels(color, ColorAdjust(**tools))


def luminance(encoded: np.ndarray) -> float:
    return float(color_adjust.srgb_to_linear(encoded) @ LUMA)


def hue_degrees(encoded: np.ndarray) -> float:
    red, green, blue = (float(channel) for channel in encoded)
    return colorsys.rgb_to_hsv(red, green, blue)[0] * 360.0


class IdentityTests(unittest.TestCase):
    def test_resting_tools_return_every_color_unchanged(self) -> None:
        colors = np.random.default_rng(0).random((500, 3))

        np.testing.assert_allclose(adjust_pixels(colors, ColorAdjust()), colors, atol=1e-12)

    def test_resting_tools_are_identity_and_any_tool_breaks_it(self) -> None:
        self.assertTrue(color_adjust.is_adjust_identity(ColorAdjust()))
        for tool in ColorAdjust.model_fields:
            with self.subTest(tool=tool):
                self.assertFalse(color_adjust.is_adjust_identity(ColorAdjust(**{tool: 0.1})))

    def test_detail_tools_leave_the_lut_at_rest(self) -> None:
        self.assertTrue(
            color_adjust.is_global_identity(ColorAdjust(definition=0.5, noise_reduction=0.5))
        )
        self.assertFalse(color_adjust.is_global_identity(ColorAdjust(hue=10.0)))


class ToneCurveTests(unittest.TestCase):
    def test_every_tone_tool_is_monotonic_at_its_extremes(self) -> None:
        levels = np.linspace(0.0, 1.0, 4001)
        for tool in TONE_TOOLS:
            for value in (-1.0, -0.5, 0.5, 1.0):
                with self.subTest(tool=tool, value=value):
                    curve = tone_curve(levels, ColorAdjust(**{tool: value}))
                    self.assertGreaterEqual(float(np.diff(curve).min()), -1e-12)

    def test_the_curve_stays_within_black_and_white(self) -> None:
        levels = np.linspace(0.0, 1.0, 101)
        for tool in TONE_TOOLS:
            for value in (-1.0, 1.0):
                with self.subTest(tool=tool, value=value):
                    curve = tone_curve(levels, ColorAdjust(**{tool: value}))
                    self.assertGreaterEqual(float(curve.min()), 0.0)
                    self.assertLessEqual(float(curve.max()), 1.0)


class DirectionTests(unittest.TestCase):
    def test_exposure_brightens_and_darkens_but_keeps_white_white(self) -> None:
        self.assertGreater(luminance(adjusted(MID_GREY, exposure=0.5)), luminance(MID_GREY))
        self.assertLess(luminance(adjusted(MID_GREY, exposure=-0.5)), luminance(MID_GREY))
        np.testing.assert_allclose(adjusted(np.ones(3), exposure=1.0), np.ones(3), atol=1e-9)

    def test_brightness_moves_midtones_but_not_the_ends(self) -> None:
        self.assertGreater(adjusted(MID_GREY, brightness=0.5)[0], 0.5)
        self.assertLess(adjusted(MID_GREY, brightness=-0.5)[0], 0.5)
        np.testing.assert_allclose(adjusted(np.zeros(3), brightness=1.0), np.zeros(3), atol=1e-9)
        np.testing.assert_allclose(adjusted(np.ones(3), brightness=-1.0), np.ones(3), atol=1e-9)

    def test_highlights_pull_down_bright_tones_more_than_shadows(self) -> None:
        light_drop = LIGHT_GREY[0] - adjusted(LIGHT_GREY, highlights=-1.0)[0]
        dark_drop = DARK_GREY[0] - adjusted(DARK_GREY, highlights=-1.0)[0]

        self.assertGreater(light_drop, 0.05)
        self.assertGreater(light_drop, dark_drop)

    def test_shadows_lift_dark_tones_more_than_highlights(self) -> None:
        dark_rise = adjusted(DARK_GREY, shadows=1.0)[0] - DARK_GREY[0]
        light_rise = adjusted(LIGHT_GREY, shadows=1.0)[0] - LIGHT_GREY[0]

        self.assertGreater(dark_rise, 0.05)
        self.assertGreater(dark_rise, light_rise)

    def test_contrast_spreads_tones_around_the_middle(self) -> None:
        harder = adjusted(np.array([DARK_GREY, LIGHT_GREY]), contrast=1.0)
        softer = adjusted(np.array([DARK_GREY, LIGHT_GREY]), contrast=-1.0)

        self.assertGreater(harder[1, 0] - harder[0, 0], LIGHT_GREY[0] - DARK_GREY[0])
        self.assertLess(softer[1, 0] - softer[0, 0], LIGHT_GREY[0] - DARK_GREY[0])

    def test_black_point_clips_or_lifts_the_darks(self) -> None:
        near_black = np.array([0.1, 0.1, 0.1])

        np.testing.assert_allclose(adjusted(near_black, black_point=1.0), np.zeros(3), atol=1e-9)
        self.assertGreater(adjusted(np.zeros(3), black_point=-1.0)[0], 0.1)

    def test_white_point_stretches_or_dims_the_lights(self) -> None:
        near_white = np.array([0.85, 0.85, 0.85])

        np.testing.assert_allclose(adjusted(near_white, white_point=1.0), np.ones(3), atol=1e-9)
        self.assertLess(adjusted(np.ones(3), white_point=-1.0)[0], 0.9)
        self.assertGreater(adjusted(LIGHT_GREY, white_point=0.5)[0], LIGHT_GREY[0])

    def test_brilliance_opens_shadows_and_holds_back_highlights(self) -> None:
        self.assertGreater(adjusted(DARK_GREY, brilliance=1.0)[0], DARK_GREY[0])
        self.assertLess(adjusted(LIGHT_GREY, brilliance=1.0)[0], LIGHT_GREY[0])


class ColorTests(unittest.TestCase):
    def test_full_desaturation_is_grey(self) -> None:
        grey = adjusted(BRICK, saturation=-1.0)

        self.assertAlmostEqual(float(grey.max() - grey.min()), 0.0, places=6)

    def test_pulling_saturation_back_keeps_an_orange_orange(self) -> None:
        orange = np.array([0.95, 0.5, 0.1])
        muted = adjusted(orange, saturation=-0.6)

        # Scaled in linear light it drifted 11 degrees toward pink.
        self.assertLess(abs(hue_degrees(muted) - hue_degrees(orange)), 6.0)

    def test_vibrance_favours_muted_colors(self) -> None:
        def chroma(color: np.ndarray) -> float:
            return float(color.max() - color.min())

        muted_gain = chroma(adjusted(MUTED, vibrance=1.0)) / chroma(MUTED)
        vivid_gain = chroma(adjusted(BRICK, vibrance=1.0)) / chroma(BRICK)

        self.assertGreater(muted_gain, vivid_gain)
        self.assertGreater(vivid_gain, 1.0)

    def test_warmth_and_tint_shift_the_expected_channels(self) -> None:
        warm = adjusted(MID_GREY, warmth=0.5)
        magenta = adjusted(MID_GREY, tint=0.5)

        self.assertGreater(warm[0], warm[2])
        self.assertGreater(magenta[0], magenta[1])
        self.assertGreater(magenta[2], magenta[1])

    def test_greys_keep_their_luminance_under_white_balance(self) -> None:
        self.assertAlmostEqual(
            luminance(adjusted(MID_GREY, warmth=1.0, tint=-1.0)), luminance(MID_GREY), places=6
        )

    def test_a_half_turn_of_hue_swaps_red_for_cyan(self) -> None:
        red = adjusted(np.array([0.8, 0.2, 0.2]), hue=180.0)

        self.assertLess(red[0], red[1])
        self.assertLess(red[0], red[2])


class GamutTests(unittest.TestCase):
    def test_out_of_range_colors_are_pulled_in_keeping_their_luminance(self) -> None:
        colors = np.array([[1.4, 0.2, 0.1], [-0.2, 0.5, 0.9], [0.3, 1.8, -0.4]])

        fitted = fit_gamut(colors)

        self.assertGreaterEqual(float(fitted.min()), -1e-12)
        self.assertLessEqual(float(fitted.max()), 1.0 + 1e-12)
        np.testing.assert_allclose(fitted @ LUMA, np.clip(colors @ LUMA, 0, 1), atol=1e-9)

    def test_colors_already_in_range_are_untouched(self) -> None:
        colors = np.random.default_rng(1).random((50, 3))

        np.testing.assert_allclose(fit_gamut(colors), colors)

    def test_every_extreme_setting_stays_in_range(self) -> None:
        colors = np.random.default_rng(2).random((300, 3))
        for tool in GLOBAL_TOOLS:
            for value in (-180.0, 180.0) if tool == "hue" else (-1.0, 1.0):
                with self.subTest(tool=tool, value=value):
                    result = adjust_pixels(colors, ColorAdjust(**{tool: value}))
                    self.assertGreaterEqual(float(result.min()), 0.0)
                    self.assertLessEqual(float(result.max()), 1.0)


class LutTests(unittest.TestCase):
    ADJUST = ColorAdjust(exposure=0.3, shadows=0.4, warmth=0.2, vibrance=0.3, hue=20.0)

    def test_the_lut_is_the_pixel_function_on_a_grid_with_red_fastest(self) -> None:
        lut = adjust_lut(self.ADJUST, size=5)

        blue, green, red = 1, 3, 4
        expected = adjust_pixels(np.array([red, green, blue]) / 4.0, self.ADJUST)
        np.testing.assert_allclose(lut[blue, green, red], expected, atol=1e-6)

    def test_pillow_reads_the_table_in_the_same_order(self) -> None:
        image = Image.new("RGB", (1, 1), (255, 0, 0))

        filtered = image.filter(lut_filter(self.ADJUST)).getpixel((0, 0))

        expected = np.round(adjust_pixels(np.array([1.0, 0.0, 0.0]), self.ADJUST) * 255)
        self.assertEqual(filtered, tuple(int(value) for value in expected))

    def test_the_cube_file_lists_red_fastest_after_its_size(self) -> None:
        lut = adjust_lut(self.ADJUST, size=3)

        with TemporaryDirectory() as folder:
            path = Path(folder) / "adjust.cube"
            write_cube(path, lut)
            lines = path.read_text(encoding="ascii").splitlines()

        self.assertEqual(lines[0], "LUT_3D_SIZE 3")
        self.assertEqual(len(lines), 1 + 27)
        second = [float(value) for value in lines[2].split()]
        np.testing.assert_allclose(second, lut[0, 0, 1], atol=1e-6)


if __name__ == "__main__":
    unittest.main()
