from __future__ import annotations

import logging
import unittest

import logging_config
from logging_config import configure_logging, resolve_log_level


class LoggingConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        root = logging.getLogger()
        self._saved_handlers = list(root.handlers)
        self._saved_level = root.level
        self._saved_configured = logging_config._CONFIGURED
        root.handlers.clear()
        logging_config._CONFIGURED = False

    def tearDown(self) -> None:
        root = logging.getLogger()
        root.handlers.clear()
        root.handlers.extend(self._saved_handlers)
        root.setLevel(self._saved_level)
        logging_config._CONFIGURED = self._saved_configured

    def test_resolve_log_level_accepts_name_and_int(self) -> None:
        self.assertEqual(resolve_log_level("debug"), logging.DEBUG)
        self.assertEqual(resolve_log_level(logging.WARNING), logging.WARNING)

    def test_configure_logging_is_idempotent(self) -> None:
        configure_logging(level="INFO")
        first_handlers = list(logging.getLogger().handlers)

        configure_logging(level="DEBUG")

        self.assertEqual(logging.getLogger().handlers, first_handlers)
        self.assertEqual(logging.getLogger().level, logging.DEBUG)


if __name__ == "__main__":
    unittest.main()
