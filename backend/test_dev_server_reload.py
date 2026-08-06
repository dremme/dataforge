"""Regression guards for scripts/dev_server.py reload settings.

The UI holds an SSE connection open. Without a finite graceful-shutdown timeout,
uvicorn reload waits forever for that stream and the API never comes back.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent
DEV_SERVER_PATH = ROOT / "scripts" / "dev_server.py"


def _load_dev_server() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dataforge_dev_server", DEV_SERVER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {DEV_SERVER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DevServerReloadSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dev_server = _load_dev_server()

    def test_graceful_shutdown_timeout_is_finite(self) -> None:
        timeout = self.dev_server.GRACEFUL_SHUTDOWN_SECONDS
        self.assertIsInstance(timeout, int)
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 10)

    def test_reload_kwargs_include_graceful_shutdown_timeout(self) -> None:
        kwargs = self.dev_server.build_uvicorn_kwargs(
            host="127.0.0.1",
            port=8080,
            reload=True,
        )
        self.assertEqual(
            kwargs["timeout_graceful_shutdown"],
            self.dev_server.GRACEFUL_SHUTDOWN_SECONDS,
        )
        self.assertTrue(kwargs["reload"])
        self.assertIn("reload_excludes", kwargs)
        self.assertEqual(kwargs["reload_delay"], self.dev_server.RELOAD_DELAY)

    def test_no_reload_still_caps_graceful_shutdown(self) -> None:
        kwargs = self.dev_server.build_uvicorn_kwargs(
            host="127.0.0.1",
            port=8080,
            reload=False,
        )
        self.assertFalse(kwargs["reload"])
        self.assertEqual(
            kwargs["timeout_graceful_shutdown"],
            self.dev_server.GRACEFUL_SHUTDOWN_SECONDS,
        )
        self.assertNotIn("reload_excludes", kwargs)
        self.assertNotIn("reload_delay", kwargs)
