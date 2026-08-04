"""Development server with hot-reload tuned for DataForge.

Run from the project root:
  backend/.venv/Scripts/python scripts/dev_server.py

Excludes test-only modules so editing tests does not restart the API and wipe
in-memory job state. Pass --no-reload to freeze the server: every restart re-runs
job recovery, which re-spawns worker threads for resumable jobs, so reloading
while a long job runs is disruptive.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn

BACKEND = Path(__file__).resolve().parent.parent / "backend"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8080

# Glob patterns passed to uvicorn's watchfiles filter (pathlib Path.match).
# Only *.py files reach this filter, so non-Python assets need no entries.
RELOAD_EXCLUDES = [
    "test_*.py",
    "_test_*.py",
    "testing_fixtures.py",
    # Directory excludes must be absolute: uvicorn's FileFilter compares them
    # against the absolute paths watchfiles reports, so a relative "data" would
    # silently never match. The watch root is always the cwd (backend/), which
    # uvicorn appends regardless of reload_dirs -- excluding is the only lever.
    str(BACKEND / ".venv"),
    str(BACKEND / "data"),
]

# watchfiles already debounces ~1.6s; this widens the window uvicorn waits before
# draining changes, so a formatter run or a multi-file save lands as one restart
# instead of a string of them.
RELOAD_DELAY = 1.0

_FALSEY = {"0", "false", "no", "off", ""}


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in _FALSEY


def _env_port(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"[warn] Ignoring {name}={raw!r}: not a port number.")
        return default


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the DataForge API with hot reload.")
    parser.add_argument(
        "--host",
        default=os.environ.get("DATAFORGE_API_HOST", DEFAULT_HOST),
        help=f"Interface to bind (default: {DEFAULT_HOST}, or DATAFORGE_API_HOST).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=_env_port("DATAFORGE_API_PORT", DEFAULT_PORT),
        help=f"Port to bind (default: {DEFAULT_PORT}, or DATAFORGE_API_PORT).",
    )
    reload_flags = parser.add_mutually_exclusive_group()
    reload_flags.add_argument(
        "--reload",
        dest="reload",
        action="store_true",
        default=None,
        help="Force hot reload on (the default).",
    )
    reload_flags.add_argument(
        "--no-reload",
        dest="reload",
        action="store_false",
        help="Run without the reloader. Use while a long job is running.",
    )
    args = parser.parse_args(argv)
    if args.reload is None:
        args.reload = _env_flag("DATAFORGE_RELOAD", True)
    return args


if __name__ == "__main__":
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    from env_file import load_env_file
    from logging_config import configure_logging

    # Parent process loads .env; reloader child also loads via main:app.
    load_env_file()
    configure_logging()

    # Parsed after .env so DATAFORGE_API_PORT can come from there.
    options = _parse_args()

    reload_state = "on" if options.reload else "off (--no-reload)"
    print(
        f"DataForge API on http://{options.host}:{options.port}  |  hot reload: {reload_state}",
        flush=True,
    )

    reload_settings = {}
    if options.reload:
        # uvicorn warns about these when reload is off, so only pass them when on.
        reload_settings = {
            "reload_excludes": RELOAD_EXCLUDES,
            "reload_delay": RELOAD_DELAY,
        }

    uvicorn.run(
        "main:app",
        host=options.host,
        port=options.port,
        reload=options.reload,
        **reload_settings,
    )
