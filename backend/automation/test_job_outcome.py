import unittest
from typing import get_args

from automation.job_outcome import (
    completion_notification,
    effective_status,
    job_response,
    shows_warning_state,
    warning_message,
)
from constants import JOB_TYPE_LABELS
from schemas import JobType


def snapshot(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": "job-1",
        "folder": r"C:\Photos",
        "folder_name": "Photos",
        "job_type": "auto_caption",
        "status": "completed",
        "total": 5,
        "processed": 5,
        "stats": {"success": 5},
        "created_at": "2026-01-01T00:00:00.000Z",
    }
    base.update(overrides)
    return base


class EffectiveStatusTests(unittest.TestCase):
    def test_a_completed_job_holding_api_errors_reads_as_failed(self) -> None:
        self.assertEqual(
            effective_status("set_captions", "completed", {"success": 1, "api_error": 1}),
            "failed",
        )

    def test_verify_captions_counts_parse_errors_as_failure(self) -> None:
        self.assertEqual(
            effective_status("verify_captions", "completed", {"parse_error": 1}), "failed"
        )

    def test_a_clean_completion_stays_completed(self) -> None:
        self.assertEqual(effective_status("auto_caption", "completed", {"success": 3}), "completed")

    def test_a_running_job_is_never_promoted(self) -> None:
        self.assertEqual(effective_status("auto_caption", "running", {"api_error": 9}), "running")


class WarningMessageTests(unittest.TestCase):
    def test_it_flags_completed_jobs_that_skipped_files_without_caption_sidecars(self) -> None:
        stats = {"success": 2, "no_caption": 1}
        self.assertTrue(shows_warning_state("auto_caption", "completed", stats))
        self.assertEqual(
            warning_message("auto_caption", "completed", stats),
            "1 file had no caption sidecar (.txt) and was skipped.",
        )

    def test_it_pluralizes_the_missing_caption_warning(self) -> None:
        self.assertEqual(
            warning_message("auto_caption", "completed", {"success": 2, "no_caption": 3}),
            "3 files had no caption sidecar (.txt) and were skipped.",
        )

    def test_edit_captions_warns_rather_than_fails_when_captions_came_back_unusable(self) -> None:
        self.assertEqual(
            warning_message("edit_captions", "completed", {"success": 8, "rejected": 2}),
            "2 captions came back in a form the job would not write, and were left unchanged.",
        )

    def test_it_reads_a_single_rejection_as_one(self) -> None:
        self.assertEqual(
            warning_message("edit_captions", "completed", {"success": 9, "rejected": 1}),
            "1 caption came back in a form the job would not write, and was left unchanged.",
        )

    def test_it_reports_a_missing_caption_and_an_unusable_one_side_by_side(self) -> None:
        message = warning_message(
            "edit_captions", "completed", {"success": 7, "rejected": 2, "no_caption": 1}
        )
        assert message is not None
        self.assertIn("no caption sidecar", message)
        self.assertIn("would not write", message)

    def test_auto_caption_reports_videos_that_had_no_audio_track(self) -> None:
        self.assertEqual(
            warning_message("auto_caption", "completed", {"success": 1, "audio_error": 1}),
            "1 video had no audio track and was captioned without it.",
        )

    def test_only_auto_caption_treats_a_missing_audio_track_as_a_warning(self) -> None:
        self.assertFalse(
            shows_warning_state("verify_captions", "completed", {"success": 1, "audio_error": 1})
        )

    def test_restore_captions_reports_backups_with_no_matching_media(self) -> None:
        self.assertEqual(
            warning_message("restore_captions", "completed", {"restored": 4, "orphaned": 1}),
            "1 backed up caption had no matching media file and was skipped.",
        )

    def test_types_that_cannot_skip_work_never_warn(self) -> None:
        for job_type in ("strip_metadata", "batch_rename", "train_lora", "watermark"):
            with self.subTest(job_type=job_type):
                self.assertIsNone(
                    warning_message(job_type, "completed", {"success": 1, "no_caption": 2})
                )

    def test_a_failing_job_reports_no_warning(self) -> None:
        self.assertIsNone(
            warning_message("auto_caption", "completed", {"no_caption": 1, "api_error": 1})
        )


class CompletionNotificationTests(unittest.TestCase):
    def test_it_returns_nothing_for_active_jobs(self) -> None:
        self.assertIsNone(completion_notification(snapshot(status="running")))

    def test_it_returns_a_success_notification_for_a_clean_completion(self) -> None:
        self.assertEqual(
            completion_notification(snapshot()),
            ("success", 'Auto-caption completed in "Photos".'),
        )

    def test_it_returns_a_warning_notification_when_a_job_finishes_with_warnings(self) -> None:
        self.assertEqual(
            completion_notification(
                snapshot(
                    job_type="verify_captions",
                    total=2,
                    processed=2,
                    stats={"success": 1, "no_caption": 1},
                )
            ),
            (
                "warning",
                'Verify captions finished with warnings in "Photos":'
                " 1 file had no caption sidecar (.txt) and was skipped.",
            ),
        )

    def test_it_returns_a_danger_notification_when_a_job_fails(self) -> None:
        self.assertEqual(
            completion_notification(
                snapshot(status="failed", stats={}, error="Model server unavailable")
            ),
            ("danger", 'Auto-caption failed in "Photos": Model server unavailable'),
        )

    def test_a_failure_without_a_stored_error_still_names_the_folder(self) -> None:
        self.assertEqual(
            completion_notification(snapshot(status="failed", stats={}, error=None)),
            ("danger", 'Auto-caption failed in "Photos".'),
        )

    def test_it_returns_a_warning_notification_when_a_job_is_cancelled(self) -> None:
        self.assertEqual(
            completion_notification(snapshot(status="cancelled", processed=2, total=10)),
            ("warning", 'Auto-caption cancelled in "Photos".'),
        )

    def test_an_interrupted_job_reads_as_a_failure(self) -> None:
        outcome = completion_notification(snapshot(status="interrupted"))
        assert outcome is not None
        self.assertEqual(outcome[0], "danger")

    def test_it_falls_back_to_the_folder_leaf_when_no_name_was_stored(self) -> None:
        self.assertEqual(
            completion_notification(snapshot(folder_name="")),
            ("success", 'Auto-caption completed in "Photos".'),
        )


class JobResponseTests(unittest.TestCase):
    def test_it_fills_in_the_derived_outcome_fields(self) -> None:
        response = job_response(snapshot(stats={"success": 2, "no_caption": 1}))
        self.assertEqual(response.effective_status, "completed")
        self.assertEqual(response.warning, "1 file had no caption sidecar (.txt) and was skipped.")

    def test_api_errors_demote_a_completed_job(self) -> None:
        response = job_response(snapshot(stats={"success": 1, "api_error": 2}))
        self.assertEqual(response.effective_status, "failed")
        self.assertIsNone(response.warning)


class JobTypeLabelTests(unittest.TestCase):
    def test_every_job_type_has_a_user_facing_label(self) -> None:
        self.assertEqual(set(JOB_TYPE_LABELS), set(get_args(JobType.__value__)))


if __name__ == "__main__":
    unittest.main()
