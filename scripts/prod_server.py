"""Production server: one uvicorn process serving the API and the built UI.

Run from the project root, after building the frontend:
  cd frontend && npm run build && cd ..
  backend/.venv/Scripts/python scripts/prod_server.py

Binds DATAFORGE_UI_PORT, the port the browser already points at, and serves
frontend/dist at / alongside /api. One origin means no proxy hop and no CORS.

Single process by design: the job manager and the SSE broker both hold state in
memory, so a second worker would run its own copy of each.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import uvicorn

# Before any backend import: older interpreters die on PEP 695 with a bare SyntaxError.
from py_version import require_python

require_python()

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
DIST_INDEX = ROOT / "frontend" / "dist" / "index.html"

DEFAULT_HOST = "127.0.0.1"

# Same cap as the dev server: /api/events holds SSE open and the default waits forever.
GRACEFUL_SHUTDOWN_SECONDS = 2


def _parse_args(argv: list[str] | None, *, default_port: int) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the DataForge API and built UI.")
    parser.add_argument(
        "--host",
        default=os.environ.get("DATAFORGE_API_HOST", DEFAULT_HOST),
        help=f"Interface to bind (default: {DEFAULT_HOST}, or DATAFORGE_API_HOST).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help=f"Port to bind (default: {default_port}, from DATAFORGE_UI_PORT).",
    )
    parser.add_argument(
        "--access-log",
        action="store_true",
        help="Log every request. Off by default - one console now carries asset traffic too.",
    )
    return parser.parse_args(argv)


def build_uvicorn_kwargs(*, host: str, port: int, access_log: bool) -> dict[str, Any]:
    """Keyword arguments for ``uvicorn.run`` used by this entrypoint.

    Exposed for tests so the reloader staying off, and the finite graceful shutdown,
    cannot regress without a failing assertion.
    """
    return {
        "app": "main:app",
        "host": host,
        "port": port,
        "reload": False,
        "access_log": access_log,
        "timeout_graceful_shutdown": GRACEFUL_SHUTDOWN_SECONDS,
    }


if __name__ == "__main__":
    if not DIST_INDEX.is_file():
        print(
            f"[error] No frontend build at {DIST_INDEX}.\n"
            "        Build it first: cd frontend && npm run build",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1)

    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    # Set before main:app is imported, which is when it is read.
    os.environ["DATAFORGE_SERVE_UI"] = "1"

    from env_file import load_env_file
    from logging_config import configure_logging

    load_env_file()
    configure_logging()

    from server_settings import get_ui_port

    # Parsed after .env so DATAFORGE_UI_PORT can come from there.
    options = _parse_args(None, default_port=get_ui_port())

    print(
        f"DataForge on http://{options.host}:{options.port}  |  bundled UI, no hot reload",
        flush=True,
    )

    kwargs = build_uvicorn_kwargs(
        host=options.host,
        port=options.port,
        access_log=options.access_log,
    )
    uvicorn.run(**kwargs)
