"""Run backend linting and formatting checks.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_lint.py [--fix]
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"


def main() -> int:
    fix = "--fix" in sys.argv

    if fix:
        commands = [
            [sys.executable, "-m", "ruff", "format", "."],
            [sys.executable, "-m", "ruff", "check", "--fix", "."],
        ]
    else:
        commands = [
            [sys.executable, "-m", "ruff", "format", "--check", "."],
            [sys.executable, "-m", "ruff", "check", "."],
        ]

    for command in commands:
        print(f"$ {' '.join(command)}")
        result = subprocess.run(command, cwd=BACKEND, check=False)
        if result.returncode != 0:
            return result.returncode

    return 0


if __name__ == "__main__":
    raise SystemExit(main())