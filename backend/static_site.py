"""Serve the built frontend from the API process.

Production runs one uvicorn process for both halves: ``/api`` from the router and
everything else from ``frontend/dist``. Same origin, so CORS never applies and the
relative ``/api`` paths the frontend already uses need no build-time base URL.

Off unless ``DATAFORGE_SERVE_UI`` is set, which ``scripts/prod_server.py`` does. The
dev launcher leaves it unset, so the API keeps serving nothing at ``/`` and a stale
``dist`` can never shadow the Vite dev server.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from server_settings import serve_ui_enabled

logger = logging.getLogger(__name__)

DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

INDEX_FILE = "index.html"

# Vite content-hashes everything under assets/, so a changed file is a changed URL.
IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# The one unhashed name. Caching it would pin the browser to the previous build's
# asset URLs, so a rebuild would appear to do nothing until a hard reload.
INDEX_CACHE_CONTROL = "no-cache"


class SpaFiles(StaticFiles):
    """StaticFiles with cache headers split by what is content-hashed and what is not."""

    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        name = Path(os.fspath(full_path)).name
        cache_control = INDEX_CACHE_CONTROL if name == INDEX_FILE else IMMUTABLE_CACHE_CONTROL
        response.headers["cache-control"] = cache_control
        return response


def mount_ui(app: FastAPI, dist: Path | None = None) -> Path | None:
    """Mount the built UI at ``/`` when enabled and present.

    Returns the mounted directory, or ``None`` when the mount was skipped. A missing
    build is a warning rather than a failure: the API stays usable, which is what
    makes the error visible instead of turning startup into a crash loop.

    Call after ``include_router``: every route lives under ``/api``, so the ``/``
    mount cannot shadow the API, and the ordering keeps that explicit.
    """
    if not serve_ui_enabled():
        return None

    directory = dist if dist is not None else DIST_DIR
    if not (directory / INDEX_FILE).is_file():
        logger.warning(
            "DATAFORGE_SERVE_UI is set but %s is missing. Run 'npm run build' in frontend/.",
            directory / INDEX_FILE,
        )
        return None

    app.mount("/", SpaFiles(directory=directory, html=True), name="ui")
    logger.info("Serving the built UI from %s", directory)
    return directory
