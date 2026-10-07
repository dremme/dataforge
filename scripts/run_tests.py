"""Run backend tests against an isolated SQLite database.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_tests.py [-v]

Only failures and the closing summary are printed; ``-v`` lists every test as it runs.
"""

from __future__ import annotations

import argparse
import os
import sys
import unittest
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import coverage

BACKEND = Path(__file__).resolve().parent.parent / "backend"

PROGRESS_ENV = "DATAFORGE_PROGRESS"
PROGRESS_PREFIX = "@progress "
WARNINGS_PREFIX = "@warnings "
COVERAGE_ENV = "DATAFORGE_COVERAGE_DIR"
COVERAGE_FILE = "backend.json"


def progress_result(total: int) -> type[unittest.TextTestResult]:
    finished = 0

    class ProgressResult(unittest.TextTestResult):
        def stopTest(self, test: unittest.TestCase) -> None:
            nonlocal finished
            super().stopTest(test)
            finished += 1
            self.stream.writeln(f"{PROGRESS_PREFIX}{finished}/{total}")
            self.stream.flush()

    return ProgressResult


class WarningCounter:
    """Counts warnings as they are shown, then shows them as before.

    A passing test's buffer swallows the text, so the count is all ``run_checks`` gets. Warnings
    a test expects (``assertWarns``, ``catch_warnings(record=True)``) bypass this hook.
    """

    def __init__(self) -> None:
        self.count = 0
        self._show = warnings.showwarning

    def show(self, *args: Any, **kwargs: Any) -> None:
        self.count += 1
        self._show(*args, **kwargs)


def start_coverage() -> coverage.Coverage | None:
    if not os.environ.get(COVERAGE_ENV):
        return None
    import coverage

    collector = coverage.Coverage(data_file=None)
    collector.start()
    return collector


def write_coverage(collector: coverage.Coverage) -> None:
    collector.stop()
    collector.json_report(outfile=str(Path(os.environ[COVERAGE_ENV]) / COVERAGE_FILE))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true", help="List every test.")
    args = parser.parse_args()

    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    collector = start_coverage()
    counter = WarningCounter()
    warnings.showwarning = counter.show
    if not sys.warnoptions:
        # The runner applies this only around the run; set it now so import-time warnings count.
        warnings.simplefilter("default")

    from testing_fixtures import isolate_test_database

    isolate_test_database()
    suite = unittest.defaultTestLoader.discover(str(BACKEND), pattern="test_*.py")
    runner = unittest.TextTestRunner(
        verbosity=2 if args.verbose else 0,
        buffer=not args.verbose,
        resultclass=(
            progress_result(suite.countTestCases())
            if os.environ.get(PROGRESS_ENV)
            else unittest.TextTestResult
        ),
    )
    result = runner.run(suite)
    from db import close_all_connections

    close_all_connections()
    if collector is not None:
        write_coverage(collector)
    if counter.count:
        print(f"{WARNINGS_PREFIX}{counter.count}")
    sys.exit(0 if result.wasSuccessful() else 1)
