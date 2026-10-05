from __future__ import annotations

import unittest

from comfy_computed import math_expression, math_expression_output, resolution_selector


class ResolutionSelectorTests(unittest.TestCase):
    def test_matches_comfyui_rounding_to_the_multiple(self) -> None:
        self.assertEqual(resolution_selector("16:9 (Widescreen)", 1.0, 8), (1368, 768))
        self.assertEqual(resolution_selector("3:4 (Portrait Standard)", 0.4, 32), (576, 736))

    def test_unknown_or_invalid_inputs_are_none(self) -> None:
        self.assertIsNone(resolution_selector("5:4 (Custom)", 1.0, 8))
        self.assertIsNone(resolution_selector("1:1 (Square)", 0, 8))
        self.assertIsNone(resolution_selector("1:1 (Square)", 1.0, None))


class MathExpressionTests(unittest.TestCase):
    def test_evaluates_a_frame_count_formula_like_comfyui(self) -> None:
        expression = "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"

        result = math_expression(expression, {"a": 3.4})

        self.assertEqual(result, 90)
        self.assertEqual(math_expression_output(result, 1), 90)
        self.assertEqual(math_expression_output(7.9, 1), 7)
        self.assertEqual(math_expression_output(7.9, 0), 7.9)
        self.assertIs(math_expression_output(0, 2), False)

    def test_anything_outside_arithmetic_is_not_guessed(self) -> None:
        for expression in ("a.real", "__import__('os')", "b + 1", "[a][0]", "a if a else 1", ""):
            with self.subTest(expression=expression):
                self.assertIsNone(math_expression(expression, {"a": 2}))

    def test_huge_exponents_and_division_by_zero_are_none(self) -> None:
        self.assertIsNone(math_expression("a ** 5000", {"a": 2}))
        self.assertIsNone(math_expression("a / 0", {"a": 2}))


if __name__ == "__main__":
    unittest.main()
