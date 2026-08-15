"""Tests for the narrowed response schemas.

The frontend mirrors these models by hand and narrows several fields to unions.
These tests pin the backend to the same sets where the value is computed fresh per
request, so a value the frontend cannot represent fails here instead of reaching the
UI as an unhandled string.

They also pin the two fields that stay deliberately loose, because narrowing either
one would break a working feature rather than fix a bug.
"""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from schemas import AutoCaptionStartRequest, GalleryItem, JobResponse, UiSettingsUpdate


def _gallery_item(**overrides: object) -> GalleryItem:
    fields: dict[str, object] = {
        "name": "scene.png",
        "path": "C:\\datasets\\sample\\scene.png",
        "description": "A winding forest path covered in autumn leaves.",
        "has_description": True,
        "has_caption_file": True,
        "caption_status": "text",
        "caption_file_type": "json",
        "media_type": "image",
    }
    fields.update(overrides)
    return GalleryItem(**fields)


def _job(**overrides: object) -> JobResponse:
    fields: dict[str, object] = {
        "id": "job-1",
        "folder": "C:\\datasets\\sample",
        "status": "running",
        "total": 4,
        "processed": 1,
        "created_at": "2026-01-01T00:00:00.000Z",
    }
    fields.update(overrides)
    return JobResponse(**fields)


class GalleryItemSchemaTests(unittest.TestCase):
    def test_accepts_every_caption_status(self) -> None:
        for status in ("none", "empty", "text"):
            self.assertEqual(_gallery_item(caption_status=status).caption_status, status)

    def test_accepts_every_media_type(self) -> None:
        for media_type in ("image", "video", "sysprompt"):
            self.assertEqual(_gallery_item(media_type=media_type).media_type, media_type)

    def test_accepts_both_caption_file_types_and_none(self) -> None:
        for file_type in ("json", "txt", None):
            self.assertEqual(
                _gallery_item(caption_file_type=file_type).caption_file_type, file_type
            )

    def test_rejects_unknown_caption_status(self) -> None:
        with self.assertRaises(ValidationError):
            _gallery_item(caption_status="bogus")

    def test_rejects_the_no_caption_job_stat_key_as_a_caption_status(self) -> None:
        """``no_caption`` is a job stat key, not a caption status."""
        with self.assertRaises(ValidationError):
            _gallery_item(caption_status="no_caption")

    def test_rejects_unknown_media_type(self) -> None:
        with self.assertRaises(ValidationError):
            _gallery_item(media_type="audio")

    def test_accepts_every_media_type_the_scanner_can_emit(self) -> None:
        for media_type in ("image", "video", "gif", "sysprompt"):
            self.assertEqual(_gallery_item(media_type=media_type).media_type, media_type)

    def test_rejects_unknown_caption_file_type(self) -> None:
        with self.assertRaises(ValidationError):
            _gallery_item(caption_file_type="yaml")


class JobResponseSchemaTests(unittest.TestCase):
    def test_accepts_every_current_job_type(self) -> None:
        for job_type in (
            "auto_caption",
            "strip_metadata",
            "set_captions",
            "verify_captions",
            "batch_rename",
            "backup_captions",
            "restore_captions",
            "train_lora",
            "watermark",
        ):
            self.assertEqual(_job(job_type=job_type).job_type, job_type)

    def test_accepts_every_current_job_status(self) -> None:
        for status in ("queued", "running", "completed", "failed", "cancelled", "interrupted"):
            self.assertEqual(_job(status=status).status, status)

    def test_keeps_a_retired_job_type_from_persisted_history(self) -> None:
        """Job rows outlive the job types that wrote them.

        ``automation/jobs_store.py`` persists history, so a database in the wild holds
        types this build no longer defines. Narrowing ``job_type`` to ``JobType`` would
        fail the entire ``/api/jobs`` list on one such row; the frontend narrows and
        falls back via ``isKnownJobType`` instead.
        """
        self.assertEqual(_job(job_type="body_parts").job_type, "body_parts")

    def test_keeps_a_retired_job_status_from_persisted_history(self) -> None:
        self.assertEqual(_job(status="paused").status, "paused")


class ReasoningEffortSchemaTests(unittest.TestCase):
    """The chat template raises on an unrecognised effort, so the API must reject it first."""

    def test_accepts_every_level_the_template_supports(self) -> None:
        for effort in ("low", "medium", "xhigh"):
            self.assertEqual(
                AutoCaptionStartRequest(reasoning_effort=effort).reasoning_effort, effort
            )

    def test_defaults_to_medium(self) -> None:
        self.assertEqual(AutoCaptionStartRequest().reasoning_effort, "medium")

    def test_rejects_high_which_the_template_has_no_branch_for(self) -> None:
        with self.assertRaises(ValidationError):
            AutoCaptionStartRequest(reasoning_effort="high")


class UiSettingsUpdateSchemaTests(unittest.TestCase):
    def test_unknown_sort_is_accepted_on_purpose(self) -> None:
        """An unknown sort resets to the default instead of failing the request.

        Deliberately looser than ``UiSettingsResponse.sort``; do not narrow it to
        ``GallerySort`` without also handling the reset.
        """
        self.assertEqual(UiSettingsUpdate(sort="bogus").sort, "bogus")


if __name__ == "__main__":
    unittest.main()
