"""Development server with hot-reload tuned for DataForge.

Run from the project root:
  backend/.venv/Scripts/python scripts/dev_server.py

Excludes test-only modules so editing tests does not restart the API and wipe
in-memory job state.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn

BACKEND = Path(__file__).resolve().parent.parent / "backend"

# Glob patterns passed to uvicorn's watchfiles filter (pathlib Path.match).
RELOAD_EXCLUDES = [
    "test_*.py",
    "_test_*.py",
    "testing_fixtures.py",
]

if __name__ == "__main__":
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    from env_file import load_env_file
    from logging_config import configure_logging

    # Parent process loads .env; reloader child also loads via main:app.
    load_env_file()
    configure_logging()
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8080,
        reload=True,
        reload_excludes=RELOAD_EXCLUDES,
    )
