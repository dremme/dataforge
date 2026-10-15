"""Serve the built frontend from the API process. Off unless ``DATAFORGE_SERVE_UI`` is set."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from server_settings import serve_ui_enabled

logger = logging.getLogger(__name__)

DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

INDEX_FILE = "index.html"

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# index.html is unhashed; caching it would pin the browser to the previous build's asset URLs.
INDEX_CACHE_CONTROL = "no-cache"


class SpaFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        """A client route such as ``/editor/video`` gets the index, so a reload reopens it.

        Missing files (they have a suffix) and unknown API paths stay 404s.
        """
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            # ``path`` is OS-normalized, so it splits on either separator.
            asked = Path(path)
            if exc.status_code != 404 or asked.suffix or asked.parts[:1] == ("api",):
                raise
            return await super().get_response(INDEX_FILE, scope)

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
    """Mount the built UI at ``/`` when enabled. Call after ``include_router`` so the mount cannot shadow the API."""
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
