"""Load optional local .env files into process environment on startup."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent

# Project root first, then backend/ — first existing file wins.
_ENV_CANDIDATES = (
    _PROJECT_ROOT / ".env",
    _BACKEND_DIR / ".env",
)

# Set by the test runner so unit tests never pick up a developer machine .env.
_DISABLE_ENV_VAR = "DATAFORGE_DISABLE_DOTENV"

_loaded_path: Path | None = None
_load_attempted = False


def _dotenv_disabled() -> bool:
    return os.environ.get(_DISABLE_ENV_VAR, "").strip().lower() in {"1", "true", "yes", "on"}


def load_env_file(*, override: bool = False, force: bool = False) -> Path | None:
    """Load the first found .env (root, then backend/). OS env wins unless override=True.

    Skips when ``DATAFORGE_DISABLE_DOTENV`` is set, unless force=True (tests).
    Returns the loaded path, or None if skipped / missing.
    """
    global _loaded_path, _load_attempted

    if not force and _dotenv_disabled():
        return None

    if _load_attempted and not override and not force:
        return _loaded_path

    _load_attempted = True

    try:
        from dotenv import load_dotenv
    except ImportError:
        logger.warning("python-dotenv missing; skip .env load")
        return None

    for candidate in _ENV_CANDIDATES:
        if not candidate.is_file():
            continue
        load_dotenv(candidate, override=override)
        _loaded_path = candidate
        logger.info("Loaded environment from %s", candidate)
        return candidate

    _loaded_path = None
    return None


def reset_env_file_state_for_tests() -> None:
    global _loaded_path, _load_attempted
    _loaded_path = None
    _load_attempted = False
