"""Where ComfyUI lives and how long it is allowed to take. Values are read at call time, never at import."""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_COMFY_BASE_URL = "http://127.0.0.1:9000"

DEFAULT_WORKFLOWS_DIR = Path(__file__).resolve().parents[1] / "comfy-workflows"

# Generous: waiting too little discards a result ComfyUI has already paid for.
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
    """Origin without a trailing slash so paths can be appended."""
    return (_env_str("COMFY_BASE_URL") or DEFAULT_COMFY_BASE_URL).rstrip("/")


def get_comfy_workflows_dir() -> Path:
    raw = _env_str("COMFY_WORKFLOWS_DIR")
    return Path(raw).expanduser() if raw else DEFAULT_WORKFLOWS_DIR


def get_comfy_image_timeout() -> float:
    return _env_seconds(
        "COMFY_IMAGE_TIMEOUT",
        DEFAULT_COMFY_IMAGE_TIMEOUT_SECONDS,
        _MIN_IMAGE_TIMEOUT_SECONDS,
    )
