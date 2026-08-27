from __future__ import annotations

import unittest
from typing import get_args

from pydantic import ValidationError

from external.ostris_training import TRAINING_TEMPLATES
from schemas import (
    AutoCaptionStartRequest,
    GalleryItem,
    JobResponse,
    TrainingModel,
    TrainLoraStartRequest,
    UiSettingsUpdate,
)


def _gallery_item(**overrides: object) -> GalleryItem:
    fields: dict[str, object] = {
        "name": "scene.png",
        "path": "C:\\datasets\\sample\\scene.png",
        "description": "A winding forest path covered in autumn leaves.",
        "has_description": True,
        "has_caption_file": True,
        "caption_status": "text",
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


class JobResponseSchemaTests(unittest.TestCase):
    def test_accepts_every_current_job_type(self) -> None:
        for job_type in (
            "auto_caption",
            "strip_metadata",
            "set_captions",
            "replace_captions",
            "find_duplicates",
            "verify_captions",
            "edit_captions",
            "batch_rename",
            "backup_captions",
            "restore_captions",
            "train_lora",
            "watermark",
            "comfy_process",
        ):
            self.assertEqual(_job(job_type=job_type).job_type, job_type)

    def test_accepts_every_current_job_status(self) -> None:
        for status in ("queued", "running", "completed", "failed", "cancelled", "interrupted"):
            self.assertEqual(_job(status=status).status, status)

    def test_keeps_a_retired_job_type_from_persisted_history(self) -> None:
        """Persisted job rows can hold types this build no longer defines."""
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


class TrainingModelSchemaTests(unittest.TestCase):
    """The wire union and the template registry are two halves of one list."""

    def test_every_wire_value_has_a_template(self) -> None:
        self.assertEqual(set(get_args(TrainingModel.__value__)), set(TRAINING_TEMPLATES))

    def test_defaults_to_krea2_turbo(self) -> None:
        self.assertEqual(TrainLoraStartRequest().model, "krea2_turbo")

    def test_rejects_a_model_with_no_template(self) -> None:
        with self.assertRaises(ValidationError):
            TrainLoraStartRequest(model="no_such_model")


class UiSettingsUpdateSchemaTests(unittest.TestCase):
    def test_unknown_sort_is_accepted_on_purpose(self) -> None:
        """An unknown sort resets to the default instead of failing the request."""
        self.assertEqual(UiSettingsUpdate(sort="bogus").sort, "bogus")


if __name__ == "__main__":
    unittest.main()
