from __future__ import annotations

import unittest

from pydantic import ValidationError

from schemas import SizeFit
from size_fit import cover_size, fitted_size

#: Shared with the frontend's editSpec.test.ts: both ports must land on the same sizes.
CASES: tuple[tuple[tuple[int, int], float, int, bool, tuple[int, int] | None], ...] = (
    ((3840, 2160), 2.0, 32, False, (1920, 1088)),
    ((2048, 1536), 2.0, 32, False, (1664, 1248)),
    ((3840, 2160), 2.0, 8, False, (1928, 1088)),
    ((2160, 3840), 2.0, 32, False, (1088, 1920)),
    ((1920, 1080), 2.0, 32, False, (1920, 1056)),
    ((1000, 1000), 4.0, 64, False, (960, 960)),
    ((1919, 1081), 64.0, 1, False, (1919, 1081)),
    ((1919, 1081), 64.0, 1, True, (1918, 1080)),
    ((1920, 1080), 1.0, 5, True, (1370, 770)),
    ((1000, 20), 1.0, 32, False, None),
)


class FittedSizeTests(unittest.TestCase):
    def test_the_shared_table(self) -> None:
        for size, megapixels, multiple, even, expected in CASES:
            with self.subTest(size=size, megapixels=megapixels, multiple=multiple, even=even):
                fit = SizeFit(megapixels=megapixels, multiple=multiple)
                self.assertEqual(fitted_size(size, fit, even=even), expected)

    def test_both_aspects_land_near_the_same_budget(self) -> None:
        fit = SizeFit(megapixels=2.0, multiple=32)
        for size in ((3840, 2160), (4000, 3000), (3000, 3000), (2160, 3840)):
            with self.subTest(size=size):
                result = fitted_size(size, fit)
                assert result is not None
                self.assertAlmostEqual(result[0] * result[1] / (1024 * 1024), 2.0, delta=0.1)
                self.assertEqual((result[0] % 32, result[1] % 32), (0, 0))

    def test_never_reaches_past_the_source(self) -> None:
        fit = SizeFit(megapixels=8.0, multiple=32)
        for size in ((640, 480), (1000, 333), (33, 4000)):
            with self.subTest(size=size):
                result = fitted_size(size, fit)
                assert result is not None
                self.assertLessEqual(result[0], size[0])
                self.assertLessEqual(result[1], size[1])

    def test_a_zero_or_negative_budget_is_refused(self) -> None:
        for megapixels in (0.0, -1.0):
            with self.subTest(megapixels=megapixels), self.assertRaises(ValidationError):
                SizeFit(megapixels=megapixels, multiple=32)


class CoverSizeTests(unittest.TestCase):
    def test_covers_the_target_without_stretching(self) -> None:
        self.assertEqual(cover_size((3840, 2160), (1920, 1088)), (1934, 1088))

    def test_an_odd_source_at_full_scale_is_never_stretched(self) -> None:
        self.assertEqual(cover_size((1921, 1081), (1920, 1056)), (1920, 1080))
