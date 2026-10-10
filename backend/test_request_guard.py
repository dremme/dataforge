from __future__ import annotations

from testing_fixtures import isolate_test_database

isolate_test_database()

import io
import os
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from request_guard import LOOPBACK_HOST_NAMES, LocalRequestGuard, allowed_host_names
from routes._test_client import client
from server_settings import get_cors_origins
from testing_fixtures import TempMediaFolder

UI_ORIGIN = get_cors_origins()[0]


def _guarded(allowed_hosts: frozenset[str] | None = LOOPBACK_HOST_NAMES) -> TestClient:
    app = FastAPI()

    @app.get("/read")
    def read() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/write")
    def write() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(LocalRequestGuard, allowed_origins=(UI_ORIGIN,), allowed_hosts=allowed_hosts)
    return TestClient(app, base_url="http://127.0.0.1:8000")


class AppGuardTests(unittest.TestCase):
    def test_a_foreign_page_cannot_import_files_into_a_folder(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                "/api/files/import",
                params={"path": str(root), "overwrite": "true"},
                files={"files": ("planted.png", io.BytesIO(b"bytes"), "image/png")},
                headers={"Origin": "https://example.com"},
            )

            self.assertEqual(response.status_code, 403)
            self.assertFalse((root / "planted.png").exists())

    def test_the_ui_can_still_write(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                "/api/files/import/preview",
                params={"path": str(root)},
                json={"filenames": ["photo.png"]},
                headers={"Origin": UI_ORIGIN},
            )

        self.assertEqual(response.status_code, 200)

    def test_a_rebound_name_is_refused(self) -> None:
        response = client.get("/api/health", headers={"Host": "rebound.example:18081"})

        self.assertEqual(response.status_code, 403)


class LocalRequestGuardTests(unittest.TestCase):
    def test_a_request_without_an_origin_passes(self) -> None:
        self.assertEqual(_guarded().post("/write").status_code, 200)

    def test_a_same_origin_write_passes_from_any_loopback_spelling(self) -> None:
        response = _guarded().post(
            "/write",
            headers={"Host": "[::1]:8000", "Origin": "http://[::1]:8000"},
        )

        self.assertEqual(response.status_code, 200)

    def test_a_foreign_origin_may_read_but_not_write(self) -> None:
        guarded = _guarded()
        foreign = {"Origin": "https://example.com"}

        self.assertEqual(guarded.get("/read", headers=foreign).status_code, 200)
        self.assertEqual(guarded.post("/write", headers=foreign).status_code, 403)

    def test_a_sandboxed_page_counts_as_foreign(self) -> None:
        response = _guarded().post("/write", headers={"Origin": "null"})

        self.assertEqual(response.status_code, 403)

    def test_any_host_is_answered_when_serving_every_interface(self) -> None:
        response = _guarded(allowed_hosts=None).get(
            "/read", headers={"Host": "workstation.lan:8000"}
        )

        self.assertEqual(response.status_code, 200)


class AllowedHostNamesTests(unittest.TestCase):
    def test_defaults_to_loopback(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(allowed_host_names(), LOOPBACK_HOST_NAMES)

    def test_adds_a_configured_address(self) -> None:
        with patch.dict(os.environ, {"DATAFORGE_API_HOST": "192.168.1.20"}, clear=True):
            names = allowed_host_names()

        assert names is not None
        self.assertIn("192.168.1.20", names)
        self.assertIn("localhost", names)

    def test_brackets_an_ipv6_address(self) -> None:
        with patch.dict(os.environ, {"DATAFORGE_API_HOST": "fd00::5"}, clear=True):
            names = allowed_host_names()

        assert names is not None
        self.assertIn("[fd00::5]", names)

    def test_a_wildcard_bind_accepts_any_host(self) -> None:
        for bind in ("0.0.0.0", "::"):
            with self.subTest(bind=bind):
                with patch.dict(os.environ, {"DATAFORGE_API_HOST": bind}, clear=True):
                    self.assertIsNone(allowed_host_names())


if __name__ == "__main__":
    unittest.main()
