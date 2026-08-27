"""The UI mount must stay off in development, never take priority over /api, and not fail startup if the build is missing."""

from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from static_site import IMMUTABLE_CACHE_CONTROL, INDEX_CACHE_CONTROL, mount_ui

INDEX_BODY = "<!doctype html><title>DataForge</title>"
ASSET_BODY = "console.log('bundle');"
ASSET_PATH = "assets/index-abc12345.js"

SERVE_UI_ON = {"DATAFORGE_SERVE_UI": "1"}


def _build_app() -> FastAPI:
    """A stand-in for main:app: one /api route, nothing else."""
    app = FastAPI()
    router = APIRouter(prefix="/api")

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)
    return app


def _write_dist(directory: Path) -> None:
    (directory / "index.html").write_text(INDEX_BODY, encoding="utf-8")
    asset = directory / ASSET_PATH
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text(ASSET_BODY, encoding="utf-8")


class StaticSiteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.dist = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.app = _build_app()

    def test_not_mounted_without_the_flag(self) -> None:
        _write_dist(self.dist)
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(mount_ui(self.app, self.dist))

        with TestClient(self.app) as client:
            self.assertEqual(client.get("/").status_code, 404)
            self.assertEqual(client.get("/api/health").status_code, 200)

    def test_missing_build_leaves_the_api_working(self) -> None:
        with patch.dict(os.environ, SERVE_UI_ON, clear=True):
            self.assertIsNone(mount_ui(self.app, self.dist / "does-not-exist"))

        with TestClient(self.app) as client:
            self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

    def test_serves_the_index(self) -> None:
        _write_dist(self.dist)
        with patch.dict(os.environ, SERVE_UI_ON, clear=True):
            self.assertEqual(mount_ui(self.app, self.dist), self.dist)

        with TestClient(self.app) as client:
            response = client.get("/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.text, INDEX_BODY)

    def test_api_is_not_shadowed_by_the_mount(self) -> None:
        _write_dist(self.dist)
        with patch.dict(os.environ, SERVE_UI_ON, clear=True):
            mount_ui(self.app, self.dist)

        with TestClient(self.app) as client:
            self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

    def test_index_is_not_cached_but_hashed_assets_are(self) -> None:
        _write_dist(self.dist)
        with patch.dict(os.environ, SERVE_UI_ON, clear=True):
            mount_ui(self.app, self.dist)

        with TestClient(self.app) as client:
            index = client.get("/index.html")
            asset = client.get(f"/{ASSET_PATH}")

        self.assertEqual(index.headers["cache-control"], INDEX_CACHE_CONTROL)
        self.assertEqual(asset.text, ASSET_BODY)
        self.assertEqual(asset.headers["cache-control"], IMMUTABLE_CACHE_CONTROL)


if __name__ == "__main__":
    unittest.main()
