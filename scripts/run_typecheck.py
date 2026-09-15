"""Run the backend type checker.

Run from the project root:
  backend/.venv/Scripts/python scripts/run_typecheck.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"


def main() -> int:
    # Settings, including the test relaxation, live in backend/pyproject.toml under [tool.ty].
    command = [sys.executable, "-m", "ty", "check", "."]

    print(f"$ {' '.join(command)}")
    return subprocess.run(command, cwd=BACKEND, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
