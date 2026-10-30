"""The transition check has to catch background fades and motion that bypasses the tokens."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
CHECK_TRANSITIONS_PATH = ROOT / "scripts" / "check_transitions.py"


def _load_check_transitions() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "dataforge_check_transitions", CHECK_TRANSITIONS_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {CHECK_TRANSITIONS_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TransitionCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.check = _load_check_transitions()

    def _problems(self, source: str) -> list[str]:
        return self.check.problems_in("sample.scss", source)

    def test_background_and_all_fail(self) -> None:
        for line in (
            "a { transition: background var(--transition); }",
            "a { transition: color var(--transition), background-color var(--transition); }",
            "a { transition-property: all; }",
        ):
            with self.subTest(line=line):
                self.assertEqual(len(self._problems(line)), 1)

    def test_literal_durations_fail(self) -> None:
        for line in (
            "a { transition: opacity 0.2s ease; }",
            "a { transition: opacity var(--transition), transform 150ms ease; }",
            "a { transition: opacity var(--duration-base) ease 0.05s; }",
            "a { transition-duration: 0.3s; }",
        ):
            with self.subTest(line=line):
                self.assertEqual(len(self._problems(line)), 1)

    def test_tokens_and_scss_variables_pass(self) -> None:
        for line in (
            "a { transition: opacity var(--transition); }",
            "a { transition: width var(--duration-slow) var(--ease-standard); }",
            "a { transition: opacity var(--duration-base) ease calc(var(--duration-fast) / 3); }",
            "a { transition: max-width $search-duration $search-ease; }",
            "a { transition: --fade-bg var(--transition); }",
            "a { transition: none; }",
            "a { transition-duration: 0s; }",
            "// transition: opacity 0.2s ease;",
        ):
            with self.subTest(line=line):
                self.assertEqual(self._problems(line), [])

    def test_the_stylesheets_pass(self) -> None:
        self.assertEqual(self.check.collect_problems(), [])


if __name__ == "__main__":
    unittest.main()
