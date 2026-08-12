"""Regression guards for scripts/prod_server.py.

Production must stay a single non-reloading process - the reloader re-runs job
recovery, and the job manager plus SSE broker hold state in memory. The graceful
shutdown timeout has to stay finite for the same reason as in dev: /api/events keeps
an SSE stream open, and uvicorn otherwise waits for it forever.
"""

from __future__ import annotations

import importlib.util
import os
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from server_settings import DEFAULT_UI_PORT

ROOT = Path(__file__).resolve().parent.parent
PROD_SERVER_PATH = ROOT / "scripts" / "prod_server.py"


def _load_prod_server() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dataforge_prod_server", PROD_SERVER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {PROD_SERVER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProdServerSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.prod_server = _load_prod_server()

    def test_graceful_shutdown_timeout_is_finite(self) -> None:
        timeout = self.prod_server.GRACEFUL_SHUTDOWN_SECONDS
        self.assertIsInstance(timeout, int)
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 10)

    def test_kwargs_never_enable_the_reloader(self) -> None:
        kwargs = self.prod_server.build_uvicorn_kwargs(
            host="127.0.0.1",
            port=8081,
            access_log=False,
        )
        self.assertEqual(kwargs["app"], "main:app")
        self.assertFalse(kwargs["reload"])
        self.assertNotIn("reload_excludes", kwargs)
        self.assertNotIn("reload_delay", kwargs)
        self.assertEqual(
            kwargs["timeout_graceful_shutdown"],
            self.prod_server.GRACEFUL_SHUTDOWN_SECONDS,
        )

    def test_access_log_is_passed_through(self) -> None:
        for access_log in (True, False):
            with self.subTest(access_log=access_log):
                kwargs = self.prod_server.build_uvicorn_kwargs(
                    host="127.0.0.1",
                    port=8081,
                    access_log=access_log,
                )
                self.assertEqual(kwargs["access_log"], access_log)

    def test_port_defaults_to_the_ui_port(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            options = self.prod_server._parse_args([], default_port=DEFAULT_UI_PORT)
        self.assertEqual(options.port, DEFAULT_UI_PORT)
        self.assertEqual(options.host, self.prod_server.DEFAULT_HOST)
        self.assertFalse(options.access_log)

    def test_explicit_arguments_win(self) -> None:
        options = self.prod_server._parse_args(
            ["--host", "0.0.0.0", "--port", "9000", "--access-log"],
            default_port=DEFAULT_UI_PORT,
        )
        self.assertEqual(options.host, "0.0.0.0")
        self.assertEqual(options.port, 9000)
        self.assertTrue(options.access_log)

    def test_host_follows_the_api_host_variable(self) -> None:
        with patch.dict(os.environ, {"DATAFORGE_API_HOST": "0.0.0.0"}, clear=True):
            options = self.prod_server._parse_args([], default_port=DEFAULT_UI_PORT)
        self.assertEqual(options.host, "0.0.0.0")


if __name__ == "__main__":
    unittest.main()
