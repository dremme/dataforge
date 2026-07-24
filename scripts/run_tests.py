"""Run backend tests against an isolated SQLite database.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_tests.py
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"

if __name__ == "__main__":
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    from testing_fixtures import isolate_test_database

    isolate_test_database()
    suite = unittest.defaultTestLoader.discover(str(BACKEND), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    from db import close_all_connections

    close_all_connections()
    sys.exit(0 if result.wasSuccessful() else 1)