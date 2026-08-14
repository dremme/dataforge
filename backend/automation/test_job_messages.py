"""Unit tests for automation.job_messages."""

from __future__ import annotations

import unittest

from automation.job_messages import (
    auto_caption_error_message,
    auto_caption_failure_message,
    resolve_job_error,
    verify_captions_failure_message,
    watermark_error_message,
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
        self.assertIn("qwen38", message)

    def test_frame_errors_blame_keyframe_extraction(self) -> None:
        message = verify_captions_failure_message({"frame_error": 2})

        self.assertIsNotNone(message)
        assert message is not None
        self.assertIn("keyframes", message)
        self.assertNotIn("model server may be running", message)
        self.assertNotIn("local model server is running", message)

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

    def test_auto_caption_is_silent_without_errors(self) -> None:
        self.assertIsNone(auto_caption_failure_message({"success": 4, "skipped_long": 1}))

    def test_auto_caption_reports_media_that_never_reached_the_model(self) -> None:
        # These files failed before any request went out, so a "restart the server"
        # message would send the user after a service that is working fine.
        message = auto_caption_failure_message({"read_error": 1, "frame_error": 2})

        self.assertEqual(
            message,
            "Failed auto-caption for 3 files. They could not be read or decoded into frames.",
        )

    def test_auto_caption_media_failure_uses_the_singular(self) -> None:
        message = auto_caption_failure_message({"frame_error": 1})

        self.assertEqual(
            message,
            "Failed auto-caption for 1 file. It could not be read or decoded into frames.",
        )

    def test_auto_caption_blames_the_server_when_requests_failed(self) -> None:
        message = auto_caption_failure_message({"api_error": 2, "frame_error": 1})

        self.assertEqual(message, auto_caption_error_message(2))

    def test_watermark_is_silent_without_errors(self) -> None:
        self.assertIsNone(watermark_error_message({"success": 4}))

    def test_watermark_blames_ffmpeg_when_only_videos_failed(self) -> None:
        message = watermark_error_message({"ffmpeg_error": 2})

        self.assertEqual(message, "Failed to watermark 2 videos. Check that ffmpeg is available.")

    def test_watermark_reassures_that_originals_survived(self) -> None:
        message = watermark_error_message({"ffmpeg_error": 1, "write_error": 1})

        self.assertEqual(message, "Failed to watermark 2 files. The originals were not changed.")

    def test_watermark_uses_the_singular_for_one_failure(self) -> None:
        message = watermark_error_message({"read_error": 1})

        self.assertEqual(message, "Failed to watermark 1 file. The original was not changed.")

    def test_resolve_job_error_reconstructs_watermark_message(self) -> None:
        message = resolve_job_error(
            job_type="watermark",
            stats={"write_error": 3},
            stored_error=None,
        )

        self.assertEqual(message, watermark_error_message({"write_error": 3}))

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
