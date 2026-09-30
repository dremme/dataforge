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
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"

PROGRESS_ENV = "DATAFORGE_PROGRESS"
PROGRESS_PREFIX = "@progress "


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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true", help="List every test.")
    args = parser.parse_args()

    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

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
    sys.exit(0 if result.wasSuccessful() else 1)
