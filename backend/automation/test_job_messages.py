"""Unit tests for automation.job_messages."""

from __future__ import annotations

import unittest

from automation.job_messages import (
    auto_caption_error_message,
    resolve_job_error,
    verify_captions_failure_message,
)
from automation.jobs import Job


class JobMessagesTests(unittest.TestCase):
    def test_parse_errors_do_not_blame_server_outage(self) -> None:
        message = verify_captions_failure_message({"parse_error": 26})

        self.assertIsNotNone(message)
        assert message is not None
        self.assertIn("26 files had model responses that were not valid JSON", message)
        self.assertIn("model server may be running", message)
        self.assertNotIn(
            "Check that the local model server is running and the vision model", message
        )

    def test_api_errors_mention_model_server(self) -> None:
        message = verify_captions_failure_message({"api_error": 2})

        self.assertIsNotNone(message)
        assert message is not None
        self.assertIn("model requests", message)
        self.assertIn("qwen", message)

    def test_resolve_job_error_prefers_stored_message(self) -> None:
        message = resolve_job_error(
            job_type="verify_captions",
            stats={"parse_error": 3},
            stored_error="Stored failure message.",
        )

        self.assertEqual(message, "Stored failure message.")

    def test_resolve_job_error_reconstructs_verify_captions_message(self) -> None:
        message = resolve_job_error(
            job_type="verify_captions",
            stats={"parse_error": 3},
            stored_error=None,
        )

        self.assertIsNotNone(message)
        assert message is not None
        self.assertIn("not valid JSON", message)

    def test_resolve_job_error_reconstructs_auto_caption_message(self) -> None:
        message = resolve_job_error(
            job_type="auto_caption",
            stats={"api_error": 2},
            stored_error=None,
        )

        self.assertEqual(message, auto_caption_error_message(2))

    def test_job_to_dict_exposes_resolved_error_for_legacy_rows(self) -> None:
        job = Job(
            id="job-legacy",
            folder="/tmp/folder",
            job_type="verify_captions",
            status="failed",
            stats={"parse_error": 2},
            error=None,
        )

        payload = job.to_dict()

        self.assertIsNotNone(payload["error"])
        assert payload["error"] is not None
        self.assertIn("not valid JSON", str(payload["error"]))


if __name__ == "__main__":
    unittest.main()
