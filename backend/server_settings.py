"""Server port settings shared by the API, its CORS policy, and the bundled UI.

Environment (all optional):

- ``DATAFORGE_API_PORT`` — port the API binds in development (also read by ``scripts/dev_server.py``)
- ``DATAFORGE_UI_PORT`` — port the Vite dev server binds; drives the CORS allowlist.
  In production the single process binds this port instead, serving API and UI together.
- ``DATAFORGE_SERVE_UI`` — serve ``frontend/dist`` at ``/``; set by ``scripts/prod_server.py``

The port values are read by ``frontend/vite.config.ts`` and ``scripts/dev-common.ps1``
from the project ``.env``, so all four stay in step.
"""

from __future__ import annotations

import os

DEFAULT_API_PORT = 8080
DEFAULT_UI_PORT = 8081

# A browser treats the two spellings of loopback as distinct origins, so the UI
# is only reachable when both are allowed.
_LOOPBACK_HOSTS = ("localhost", "127.0.0.1")

_MIN_PORT = 1
_MAX_PORT = 65535

# Same spellings scripts/dev_server.py treats as off, so one .env reads the same everywhere.
_FALSEY = {"0", "false", "no", "off", ""}


def _env_str(name: str) -> str:
    return os.environ.get(name, "").strip()


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in _FALSEY


def _env_port(name: str, default: int) -> int:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        port = int(raw)
    except ValueError:
        return default
    if not _MIN_PORT <= port <= _MAX_PORT:
        return default
    return port


def get_api_port() -> int:
    return _env_port("DATAFORGE_API_PORT", DEFAULT_API_PORT)


def get_ui_port() -> int:
    return _env_port("DATAFORGE_UI_PORT", DEFAULT_UI_PORT)


def get_cors_origins() -> tuple[str, ...]:
    """Origins allowed to call the API: the dev UI on both loopback spellings."""
    port = get_ui_port()
    return tuple(f"http://{host}:{port}" for host in _LOOPBACK_HOSTS)


def serve_ui_enabled() -> bool:
    """Whether this process also serves the built frontend. Production only."""
    return _env_flag("DATAFORGE_SERVE_UI", False)
