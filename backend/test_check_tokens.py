"""The token check has to fail on a type size that bypasses the scale."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
CHECK_TOKENS_PATH = ROOT / "scripts" / "check_tokens.py"


def _load_check_tokens() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dataforge_check_tokens", CHECK_TOKENS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {CHECK_TOKENS_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TokenCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.check = _load_check_tokens()

    def _problems(self, source: str) -> list[str]:
        return self.check.problems_in("sample.scss", source)

    def test_literal_font_sizes_fail(self) -> None:
        for line in (
            "font-size: 0.625rem;",
            "font-size: 12px;",
            "  font-size: 1.1em;",
        ):
            with self.subTest(line=line):
                self.assertEqual(len(self._problems(line)), 1)

    def test_scale_tokens_and_relative_sizes_pass(self) -> None:
        for line in (
            "font-size: var(--text-xs);",
            "font-size: $map-node-font-size;",
            "$map-node-font-size: 0.65625rem;",
            "font-size: inherit;",
            "font-size: 100%;",
            "// font-size: 10px;",
        ):
            with self.subTest(line=line):
                self.assertEqual(self._problems(line), [])

    def test_the_stylesheets_pass(self) -> None:
        self.assertEqual(self.check.collect_problems(), [])


if __name__ == "__main__":
    unittest.main()
