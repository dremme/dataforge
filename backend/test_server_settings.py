"""Tests for server_settings."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from server_settings import (
    DEFAULT_UI_PORT,
    get_cors_origins,
    get_ui_port,
    serve_ui_enabled,
)


class ServerSettingsTests(unittest.TestCase):
    def test_defaults_when_env_unset(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(get_ui_port(), DEFAULT_UI_PORT)

    def test_reads_environment_overrides(self) -> None:
        with patch.dict(os.environ, {"DATAFORGE_UI_PORT": " 9081 "}, clear=True):
            self.assertEqual(get_ui_port(), 9081)

    def test_invalid_values_fall_back_to_defaults(self) -> None:
        for raw in ("abc", "0", "65536", "-1", "80.5", ""):
            with self.subTest(raw=raw):
                with patch.dict(os.environ, {"DATAFORGE_UI_PORT": raw}, clear=True):
                    self.assertEqual(get_ui_port(), DEFAULT_UI_PORT)

    def test_cors_origins_cover_both_loopback_spellings(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                get_cors_origins(),
                (f"http://localhost:{DEFAULT_UI_PORT}", f"http://127.0.0.1:{DEFAULT_UI_PORT}"),
            )

    def test_cors_origins_follow_the_ui_port(self) -> None:
        with patch.dict(os.environ, {"DATAFORGE_UI_PORT": "9000"}, clear=True):
            self.assertEqual(
                get_cors_origins(),
                ("http://localhost:9000", "http://127.0.0.1:9000"),
            )

    def test_serve_ui_is_off_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(serve_ui_enabled())

    def test_serve_ui_reads_the_flag(self) -> None:
        for raw, expected in (
            ("1", True),
            ("true", True),
            (" ON ", True),
            ("0", False),
            ("false", False),
            ("off", False),
            ("", False),
        ):
            with self.subTest(raw=raw):
                with patch.dict(os.environ, {"DATAFORGE_SERVE_UI": raw}, clear=True):
                    self.assertEqual(serve_ui_enabled(), expected)


if __name__ == "__main__":
    unittest.main()
