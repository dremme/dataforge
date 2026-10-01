from __future__ import annotations

import unittest

from automation.job_messages import (
    auto_caption_failure_message,
    check_caption_rules_error_message,
    edit_captions_failure_message,
    verify_captions_failure_message,
    watermark_error_message,
)
from automation.jobs import JOB_SPECS, Job
from openai_settings import get_openai_model


class JobMessagesTests(unittest.TestCase):
    def test_parse_errors_do_not_blame_server_outage(self) -> None:
        message = verify_captions_failure_message({"parse_error": 26}) or ""

        self.assertIn("26 files had model responses that were not valid JSON", message)
        self.assertIn("model server may be running", message)
        self.assertNotIn("Check that the local model server is running", message)

    def test_api_errors_name_the_configured_model(self) -> None:
        message = verify_captions_failure_message({"api_error": 2}) or ""

        self.assertIn("model requests", message)
        self.assertIn(f'(id "{get_openai_model()}")', message)

    def test_frame_errors_blame_keyframe_extraction(self) -> None:
        message = verify_captions_failure_message({"frame_error": 2}) or ""

        self.assertIn("keyframes", message)
        self.assertNotIn("model server", message)

    def test_exact_messages(self) -> None:
        cases = [
            (auto_caption_failure_message, {"success": 4, "skipped_long": 1}, None),
            # These files never reached the server, so do not say to restart it.
            (
                auto_caption_failure_message,
                {"read_error": 1, "frame_error": 2},
                "Failed auto-caption for 3 files. They could not be read or decoded into frames.",
            ),
            (
                auto_caption_failure_message,
                {"frame_error": 1},
                "Failed auto-caption for 1 file. It could not be read or decoded into frames.",
            ),
            (
                auto_caption_failure_message,
                {"api_error": 2, "frame_error": 1},
                "Failed auto-caption for 2 files. Check that the local model server is running.",
            ),
            (watermark_error_message, {"success": 4}, None),
            (
                watermark_error_message,
                {"ffmpeg_error": 2},
                "Failed to watermark 2 videos. Check that ffmpeg is available.",
            ),
            (
                watermark_error_message,
                {"ffmpeg_error": 1, "write_error": 1},
                "Failed to watermark 2 files. The originals were not changed.",
            ),
            (
                watermark_error_message,
                {"read_error": 1},
                "Failed to watermark 1 file. The original was not changed.",
            ),
            (check_caption_rules_error_message, {"success": 4, "issues_found": 2}, None),
            (
                check_caption_rules_error_message,
                {"read_error": 1, "write_error": 2},
                "Failed to lint 3 files. Their captions or issue files could not be read or written.",
            ),
            (
                check_caption_rules_error_message,
                {"write_error": 1},
                "Failed to lint 1 file. Its caption or issue file could not be read or written.",
            ),
        ]
        for message_for, stats, expected in cases:
            with self.subTest(message=message_for.__name__, stats=stats):
                self.assertEqual(message_for(stats), expected)


class JobErrorResolutionTests(unittest.TestCase):
    def test_a_stored_error_wins_over_the_stats(self) -> None:
        job = Job(id="job-1", folder="/tmp/folder", job_type="verify_captions")
        job.stats = {"parse_error": 3}
        job.error = "Stored failure message."

        self.assertEqual(job.to_dict()["error"], "Stored failure message.")

    def test_a_legacy_row_without_an_error_has_it_rebuilt_from_its_stats(self) -> None:
        for job_type, stats, expected in (
            ("verify_captions", {"parse_error": 2}, verify_captions_failure_message),
            ("auto_caption", {"api_error": 2}, auto_caption_failure_message),
            ("watermark", {"write_error": 3}, watermark_error_message),
        ):
            with self.subTest(job_type=job_type):
                job = Job(id="job-1", folder="/tmp/folder", job_type=job_type, stats=stats)

                self.assertEqual(job.to_dict()["error"], expected(stats))

    def test_resolve_status_fails_a_run_whose_stats_carry_an_error(self) -> None:
        job = Job(id="job-1", folder="/tmp/folder", stats={"parse_error": 3})
        spec = JOB_SPECS["verify_captions"]

        status, error = spec.resolve_status(job, cancelled=False)
        self.assertEqual(status, "failed")
        self.assertIn("not valid JSON", error or "")
        self.assertEqual(spec.resolve_status(job, cancelled=True), ("cancelled", None))

    def test_a_training_run_stopped_in_ai_toolkit_counts_as_cancelled(self) -> None:
        spec = JOB_SPECS["train_lora"]

        stopped = Job(id="job-1", folder="/tmp/folder", stats={"stopped": 1})
        finished = Job(id="job-2", folder="/tmp/folder", stats={"success": 1})

        self.assertEqual(spec.resolve_status(stopped, cancelled=False), ("cancelled", None))
        self.assertEqual(spec.resolve_status(finished, cancelled=False), ("completed", None))


class EditCaptionsFailureMessageTests(unittest.TestCase):
    def test_warnings_are_not_errors(self) -> None:
        # The caption is intact; rejected and captionless are warnings, not a failed job.
        for stats in (
            {"success": 12, "unchanged": 3},
            {"success": 8, "rejected": 4},
            {"success": 8, "no_caption": 2},
        ):
            with self.subTest(stats=stats):
                self.assertIsNone(edit_captions_failure_message(stats))

    def test_api_errors_point_at_the_model_server(self) -> None:
        many = edit_captions_failure_message({"api_error": 3}) or ""
        one = edit_captions_failure_message({"api_error": 1}) or ""

        self.assertIn("3 captions failed their model requests", many)
        self.assertIn("local model server", many)
        self.assertIn("1 caption failed its model request", one)

    def test_write_errors_are_reported_without_the_server_pointer(self) -> None:
        message = edit_captions_failure_message({"write_error": 2}) or ""

        self.assertIn("2 captions could not be backed up or written", message)
        self.assertNotIn("local model server", message)

    def test_mixed_errors_are_all_named(self) -> None:
        message = (
            edit_captions_failure_message({"api_error": 1, "read_error": 1, "write_error": 1}) or ""
        )

        self.assertIn("model request", message)
        self.assertIn("could not be read", message)
        self.assertIn("could not be backed up or written", message)


if __name__ == "__main__":
    unittest.main()
