from __future__ import annotations

import logging
import unittest

import logging_config
from logging_config import configure_logging, log_job_summary, resolve_log_level


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

    def test_log_job_summary_emits_info_records(self) -> None:
        configure_logging(level="INFO")
        records: list[logging.LogRecord] = []

        class CaptureHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                records.append(record)

        test_logger = logging.getLogger("test.job_summary")
        test_logger.addHandler(CaptureHandler())
        test_logger.setLevel(logging.INFO)

        log_job_summary(
            test_logger,
            {
                "folder": "/tmp/folder",
                "processed": 2,
                "total": 3,
                "stats": {"success": 2, "skipped": 0},
            },
            stat_keys=("success", "skipped"),
        )

        messages = [record.getMessage() for record in records]
        self.assertIn("Folder: /tmp/folder", messages)
        self.assertIn("Processed: 2/3", messages)
        self.assertIn("  success: 2", messages)


if __name__ == "__main__":
    unittest.main()
