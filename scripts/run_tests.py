"""Run backend tests against an isolated SQLite database.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_tests.py [-v]

Only failures and the closing summary are printed; ``-v`` lists every test as it runs.
"""

from __future__ import annotations

import argparse
import json
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
#: One line per warning, its text JSON-encoded so a multi-line message stays on that line.
WARNING_PREFIX = "@warning "
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
    """Counts and describes warnings as they are shown, then shows them as before.

    A passing test's buffer swallows the text, so ``details`` is what ``run_checks`` can show:
    the warning, where it was raised, and the test running then. A ``ResourceWarning`` is raised
    where the object was collected, so the test is often the better clue. Warnings a test expects
    (``assertWarns``, ``catch_warnings(record=True)``) bypass this hook.
    """

    def __init__(self) -> None:
        self.count = 0
        self.details: list[str] = []
        self.current_test = "while loading tests"
        self._show = warnings.showwarning

    def show(
        self,
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        *args: Any,
        **kwargs: Any,
    ) -> None:
        self.count += 1
        self.details.append(
            f"{category.__name__}: {message} ({_shown_path(filename)}:{lineno}, "
            f"in {self.current_test})"
        )
        self._show(message, category, filename, lineno, *args, **kwargs)


def _shown_path(filename: str) -> str:
    try:
        return Path(filename).resolve().relative_to(BACKEND.parent).as_posix()
    except ValueError:
        return filename


def tracking_result(
    base: type[unittest.TextTestResult], counter: WarningCounter
) -> type[unittest.TextTestResult]:
    """Tells ``counter`` which test is running, so a warning names where it came from."""

    class TrackingResult(base):  # type: ignore[valid-type, misc]
        def startTest(self, test: unittest.TestCase) -> None:
            counter.current_test = test.id()
            super().startTest(test)

    return TrackingResult


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
        resultclass=tracking_result(
            (
                progress_result(suite.countTestCases())
                if os.environ.get(PROGRESS_ENV)
                else unittest.TextTestResult
            ),
            counter,
        ),
    )
    result = runner.run(suite)
    counter.current_test = "after the last test"
    from db import close_all_connections

    close_all_connections()
    if collector is not None:
        write_coverage(collector)
    if counter.count:
        for detail in counter.details:
            print(f"{WARNING_PREFIX}{json.dumps(detail)}")
        print(f"{WARNINGS_PREFIX}{counter.count}")
    sys.exit(0 if result.wasSuccessful() else 1)
