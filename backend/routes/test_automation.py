"""HTTP contract tests for /api/automation/*."""

from __future__ import annotations

import unittest
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from automation.jobs import JOB_SPECS, Job, job_manager
from db import get_connection
from external.ostris_training import OstrisTrainingError
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    reset_job_manager,
    wait_for_job,
    write_media,
    write_sysprompt,
    write_txt_caption,
)
from watermark_settings import WATERMARK_SETTINGS_KEY


@contextmanager
def _patched_job_runner(job_type: str, run: Callable[..., object]) -> Iterator[None]:
    """Swap a job type's runner. JOB_SPECS holds the function, so patching the module cannot."""
    patched = replace(JOB_SPECS[job_type], run=run)  # type: ignore[index]
    with patch.dict(JOB_SPECS, {job_type: patched}):
        yield


class AutoCaptionAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_sysprompt(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Short draft.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn(".sysprompt", response.json()["detail"])

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_rejects_duplicate_active_job(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            folder = str(root.resolve())
            with job_manager._lock:
                job_manager._jobs["running-test"] = Job(
                    id="running-test",
                    folder=folder,
                    status="running",
                )

            response = client.post(f"/api/automation/auto-caption?path={quote(folder)}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("already running", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            response = client.post(f"/api/automation/auto-caption?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["job_type"], "auto_caption")
            self.assertEqual(payload.get("auto_caption_mode"), "thinking")
            self.assertIn("id", payload)

    def _start_and_capture(self, root: Path, **body: object) -> dict[str, object]:
        """Start the job with a stubbed runner, returning the params it was handed."""
        received: dict[str, object] = {}

        def run(folder: Path, **params: object) -> dict[str, object]:
            received.update(params)
            return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}

        with _patched_job_runner("auto_caption", run):
            response = client.post(
                f"/api/automation/auto-caption?path={quote(str(root))}",
                json=body,
            )
            self.assertEqual(response.status_code, 200)
            wait_for_job(response.json()["id"])

        return received

    def test_audio_captioning_is_off_unless_asked_for(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            self.assertEqual(self._start_and_capture(root).get("caption_audio"), False)

    def test_audio_captioning_reaches_the_runner(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            received = self._start_and_capture(root, mode="instruct", caption_audio=True)

            self.assertEqual(received.get("caption_audio"), True)
            self.assertEqual(received.get("mode"), "instruct")

    def test_reasoning_knobs_default_to_medium_and_preserved(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            received = self._start_and_capture(root)

            self.assertEqual(received.get("reasoning_effort"), "medium")
            self.assertEqual(received.get("preserve_thinking"), True)

    def test_reasoning_knobs_reach_the_runner(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            received = self._start_and_capture(
                root, reasoning_effort="xhigh", preserve_thinking=False
            )

            self.assertEqual(received.get("reasoning_effort"), "xhigh")
            self.assertEqual(received.get("preserve_thinking"), False)

    def test_rejects_an_unknown_reasoning_effort(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            response = client.post(
                f"/api/automation/auto-caption?path={quote(str(root))}",
                json={"reasoning_effort": "high"},
            )
            self.assertEqual(response.status_code, 422)

    def test_audio_captioning_is_refused_without_ffmpeg(self) -> None:
        with TempMediaFolder() as root:
            write_sysprompt(root, "Describe the scene.")
            write_txt_caption(write_media(root, "photo.png"), "Draft.")

            with patch("automation.auto_caption.ffmpeg_path", return_value=None):
                response = client.post(
                    f"/api/automation/auto-caption?path={quote(str(root))}",
                    json={"caption_audio": True},
                )

                self.assertEqual(response.status_code, 400)
                self.assertIn("ffmpeg", response.json()["detail"])

                # The same folder still starts fine without audio.
                self.assertEqual(
                    client.post(
                        f"/api/automation/auto-caption?path={quote(str(root))}"
                    ).status_code,
                    200,
                )


class StripMetadataAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_rejects_folder_without_supported_files(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(f"/api/automation/strip-metadata?path={quote(str(root))}")
            self.assertEqual(response.status_code, 400)
            self.assertIn("No PNG or MP4", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png", text_chunks={"workflow": '{"nodes":{}}'})

            response = client.post(f"/api/automation/strip-metadata?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "strip_metadata")


class SetCaptionsAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(
                f"/api/automation/set-captions?path={quote(str(root))}",
                json={"caption": "Shared caption."},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(
                f"/api/automation/set-captions?path={quote(str(root))}",
                json={"caption": "Shared caption."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "set_captions")


class ReplaceCaptionsAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_requires_a_search_term(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(
                f"/api/automation/replace-captions?path={quote(str(root))}",
                json={"search": ""},
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn("text to search for", response.json()["detail"])

    def test_rejects_invalid_regex(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(
                f"/api/automation/replace-captions?path={quote(str(root))}",
                json={"search": "(unclosed", "use_regex": True},
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn("Invalid regular expression", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a dog")

            response = client.post(
                f"/api/automation/replace-captions?path={quote(str(root))}",
                json={"search": "dog", "replacement": "cat"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "replace_captions")

    def test_preview_reports_matches(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "a dog")

            response = client.post(
                f"/api/automation/replace-captions/preview?path={quote(str(root))}",
                json={"search": "dog", "replacement": "cat"},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["matched"], 1)
            self.assertIsNone(payload["error"])
            self.assertEqual(payload["samples"][0]["after"], "a cat")

    def test_preview_reports_a_bad_edit_as_a_field_not_a_400(self) -> None:
        """The dialog previews while the user types, so a half-typed regex is normal."""
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(
                f"/api/automation/replace-captions/preview?path={quote(str(root))}",
                json={"search": "(unclosed", "use_regex": True},
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertIn("Invalid regular expression", payload["error"])
            self.assertEqual(payload["matched"], 0)


class VerifyCaptionsAutomationEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        from db import get_connection
        from verify_captions_settings import VERIFY_CAPTIONS_SETTINGS_KEY

        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key = ?",
                (VERIFY_CAPTIONS_SETTINGS_KEY,),
            )
            conn.commit()

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = client.post(f"/api/automation/verify-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images", response.json()["detail"])

    def test_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "Draft.")

            response = client.post(
                f"/api/automation/verify-captions?path={quote(str(root))}",
                json={"mode": "thinking", "context": "Outdoor portraits."},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "verify_captions")


class CaptionBackupEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def test_backup_requires_a_caption(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = client.post(f"/api/automation/backup-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No captions found to back up", response.json()["detail"])

    def test_backup_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")

            response = client.post(f"/api/automation/backup-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "backup_captions")

    def _start_backup_and_capture(self, root: Path, **body: object) -> dict[str, object]:
        """Start the backup with a stubbed runner, returning the params it was handed."""
        received: dict[str, object] = {}

        def run(folder: Path, **params: object) -> dict[str, object]:
            received.update(params)
            return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}

        with _patched_job_runner("backup_captions", run):
            response = client.post(
                f"/api/automation/backup-captions?path={quote(str(root))}",
                json=body,
            )
            self.assertEqual(response.status_code, 200)
            wait_for_job(response.json()["id"])

        return received

    def test_backup_does_not_overwrite_unless_asked_for(self) -> None:
        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "photo.png"), "A plain caption.")

            self.assertEqual(self._start_backup_and_capture(root).get("overwrite"), False)

    def test_backup_overwrite_reaches_the_runner(self) -> None:
        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "photo.png"), "A plain caption.")

            received = self._start_backup_and_capture(root, overwrite=True)

            self.assertEqual(received.get("overwrite"), True)

    def test_restore_requires_an_existing_backup(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")

            response = client.post(f"/api/automation/restore-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 400)
            self.assertIn("No caption backup found", response.json()["detail"])

    def test_restore_starts_job_and_returns_payload(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A plain caption.")
            run_backup_captions_job(root)
            reset_job_manager()

            response = client.post(f"/api/automation/restore-captions?path={quote(str(root))}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["job_type"], "restore_captions")


class WatermarkAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute("DELETE FROM preferences WHERE key = ?", (WATERMARK_SETTINGS_KEY,))
            conn.commit()

    def _start(self, folder: Path, **body: object) -> object:
        payload = {"text": "Sample Studio", **body}
        return client.post(f"/api/automation/watermark?path={quote(str(folder))}", json=payload)

    def test_requires_watermark_text(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, text="  ")

            self.assertEqual(response.status_code, 400)
            self.assertIn("cannot be empty", response.json()["detail"])

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = self._start(root)

            self.assertEqual(response.status_code, 400)
            self.assertIn("No JPG, PNG, WebP, BMP, MP4, MOV or M4V", response.json()["detail"])

    def test_rejects_an_unknown_size_opacity_or_position(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            for body in ({"size": "huge"}, {"opacity": 33}, {"position": "side"}):
                with self.subTest(body=body):
                    self.assertEqual(self._start(root, **body).status_code, 422)

    def test_starts_job_and_passes_the_settings_through(self) -> None:
        received: dict[str, object] = {}

        def run(folder: Path, **params: object) -> dict[str, object]:
            received.update(params)
            return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}

        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with _patched_job_runner("watermark", run):
                response = self._start(root, size="large", opacity=75, position="top")

                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload["job_type"], "watermark")
                wait_for_job(payload["id"])

        self.assertEqual(received["text"], "Sample Studio")
        self.assertEqual(received["size"], "large")
        self.assertEqual(received["opacity"], 75)
        self.assertEqual(received["position"], "top")

    def test_starting_a_job_stores_the_settings_for_next_time(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            self._start(root, size="large", opacity=25, position="center")

            self.assertEqual(
                client.get("/api/preferences/watermark").json(),
                {
                    "text": "Sample Studio",
                    "size": "large",
                    "opacity": 25,
                    "position": "center",
                },
            )


class TrainLoraAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def _start(self, folder: Path, **body: object) -> object:
        payload = {
            "lora_name": "sample_train_v1",
            "trigger_word": "",
            "prompts": ["a mountain lake at sunrise"],
            **body,
        }
        return client.post(f"/api/automation/train-lora?path={quote(str(folder))}", json=payload)

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = self._start(root)

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_requires_a_lora_name(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, lora_name="  ")

            self.assertEqual(response.status_code, 400)
            self.assertIn("name", response.json()["detail"])

    def test_requires_at_least_one_prompt(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, prompts=[])

            self.assertEqual(response.status_code, 400)
            self.assertIn("prompt", response.json()["detail"])

    def test_rejects_a_name_that_would_escape_the_training_folder(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, lora_name="..\\secrets")

            self.assertEqual(response.status_code, 400)

    def test_starts_job_and_co_tracks_the_external_run(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            def finished(folder: Path, **_params: object) -> dict[str, object]:
                return {
                    "folder": str(folder),
                    "total": 1000,
                    "processed": 1000,
                    "stats": {"step": 1000, "stopped": 0},
                    "results": [],
                }

            with _patched_job_runner("train_lora", finished):
                response = self._start(root)
                job_id = response.json()["id"]
                wait_for_job(job_id)

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["job_type"], "train_lora")
            self.assertEqual(payload["external_ref"], "sample_train_v1")

            job = job_manager.get_job(job_id)
            assert job is not None
            self.assertEqual(job.status, "completed")

    def test_reports_a_duplicate_training_name(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            def duplicate(_folder: Path, **_params: object) -> dict[str, object]:
                raise OstrisTrainingError(
                    'A training job named "sample_train_v1" already exists in AI-Toolkit.'
                )

            with _patched_job_runner("train_lora", duplicate):
                response = self._start(root)
                job_id = response.json()["id"]
                wait_for_job(job_id)

            job = job_manager.get_job(job_id)
            assert job is not None
            self.assertEqual(job.status, "failed")
            self.assertIn("already exists", job.error or "")


if __name__ == "__main__":
    unittest.main()
