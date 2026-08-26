"""Where ComfyUI lives and how long it is allowed to take.

Environment (all optional):

- ``COMFY_BASE_URL`` — the running ComfyUI, default ``http://127.0.0.1:9000``
- ``COMFY_WORKFLOWS_DIR`` — folder of API-format workflow presets, default
  ``<repo>/comfy-workflows``
- ``COMFY_IMAGE_TIMEOUT`` — seconds to wait for one image before giving up on it

ComfyUI gets an env-configurable base URL where ``external.ostris_jobs`` hardcodes one.
That asymmetry is deliberate rather than an oversight: AI-Toolkit's URL is threaded
through a feed, two routes and their tests, and moving it is its own change. A ComfyUI
install is far more likely to sit on another port or another box, so it starts out
configurable.

Every value is read at call time, never at import, so a reloaded ``.env`` and a test
that monkeypatches ``os.environ`` both take effect.
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_COMFY_BASE_URL = "http://127.0.0.1:9000"

DEFAULT_WORKFLOWS_DIR = Path(__file__).resolve().parents[1] / "comfy-workflows"

# One image through an upscale graph on a busy GPU. Generous on purpose: the cost of
# waiting too long is a slow job, the cost of waiting too little is a discarded result
# that ComfyUI has already paid for.
DEFAULT_COMFY_IMAGE_TIMEOUT_SECONDS = 900.0

_MIN_IMAGE_TIMEOUT_SECONDS = 30.0


def _env_str(name: str) -> str:
    return os.environ.get(name, "").strip()


def _env_seconds(name: str, default: float, minimum: float) -> float:
    raw = _env_str(name)
    if not raw:
        return default
    try:
        seconds = float(raw)
    except ValueError:
        return default
    return seconds if seconds >= minimum else default


def get_comfy_base_url() -> str:
    """The ComfyUI origin, without a trailing slash so paths can be appended."""
    return (_env_str("COMFY_BASE_URL") or DEFAULT_COMFY_BASE_URL).rstrip("/")


def get_comfy_workflows_dir() -> Path:
    """Folder holding the API-format workflow presets."""
    raw = _env_str("COMFY_WORKFLOWS_DIR")
    return Path(raw).expanduser() if raw else DEFAULT_WORKFLOWS_DIR


def get_comfy_image_timeout() -> float:
    return _env_seconds(
        "COMFY_IMAGE_TIMEOUT",
        DEFAULT_COMFY_IMAGE_TIMEOUT_SECONDS,
        _MIN_IMAGE_TIMEOUT_SECONDS,
    )
