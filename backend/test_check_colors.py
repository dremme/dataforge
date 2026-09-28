"""The color check has to fail on what would freeze a color, or the light theme drifts."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
CHECK_COLORS_PATH = ROOT / "scripts" / "check_colors.py"


def _load_check_colors() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dataforge_check_colors", CHECK_COLORS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {CHECK_COLORS_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ColorCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.check = _load_check_colors()

    def _problems(self, source: str) -> list[str]:
        return self.check.problems_in("sample.scss", source)

    def test_every_frozen_color_form_fails(self) -> None:
        for line in (
            "color: #fcd34d;",
            "background: rgba(0, 0, 0, 0.5);",
            "outline: 1px dashed rgb(255 255 255 / 0.6);",
            "color: white;",
        ):
            with self.subTest(line=line):
                self.assertEqual(len(self._problems(line)), 1)

    def test_theme_tokens_and_lookalikes_pass(self) -> None:
        for line in (
            "color: var(--warning);",
            "background: color-mix(in srgb, var(--caption-error) 12%, transparent);",
            "--bg-elevated: #{$bg-token};",
            "white-space: nowrap;",
            "// was #fcd34d before the theme",
        ):
            with self.subTest(line=line):
                self.assertEqual(self._problems(line), [])

    def test_the_stylesheets_pass(self) -> None:
        self.assertEqual(self.check.collect_problems(), [])


if __name__ == "__main__":
    unittest.main()
