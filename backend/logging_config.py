from __future__ import annotations

import logging
import os
import sys

DEFAULT_LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
DATE_FORMAT = "%H:%M:%S"

_CONFIGURED = False


def resolve_log_level(level: str | int | None = None) -> int:
    if level is None:
        level = os.environ.get("DATAFORGE_LOG_LEVEL", DEFAULT_LOG_LEVEL)
    if isinstance(level, int):
        return level
    return getattr(logging, str(level).upper(), logging.INFO)


def configure_logging(*, level: str | int | None = None) -> None:
    global _CONFIGURED

    resolved_level = resolve_log_level(level)
    root = logging.getLogger()

    if _CONFIGURED:
        root.setLevel(resolved_level)
        return

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))

    root.setLevel(resolved_level)
    root.addHandler(handler)

    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    logging.getLogger("watchfiles").setLevel(logging.WARNING)

    _CONFIGURED = True
