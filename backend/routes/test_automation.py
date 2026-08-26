"""HTTP contract tests for /api/automation/*."""

from __future__ import annotations

import os
import unittest
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

from automation.backup_captions import run_backup_captions_job
from automation.jobs import JOB_SPECS, Job, job_manager
from automation_settings import AUTOMATION_SETTINGS_KEY_PREFIX, JOB_SETTINGS_MODELS
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


@contextmanager
def _patched_job_runner(job_type: str, run: Callable[..., object]) -> Iterator[None]:
    """Swap a job type's runner. JOB_SPECS holds the function, so patching the module cannot."""
    patched = replace(JOB_SPECS[job_type], run=run)  # type: ignore[index]
    with patch.dict(JOB_SPECS, {job_type: patched}):
        yield


def _stored_settings(folder: Path) -> dict:
    """Every job's remembered settings for ``folder``, as the dialogs would read them."""
    response = client.get(f"/api/preferences/automation?path={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


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
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key LIKE ?",
                (f"{AUTOMATION_SETTINGS_KEY_PREFIX}.%",),
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


class EditCaptionsAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key LIKE ?",
                (f"{AUTOMATION_SETTINGS_KEY_PREFIX}.%",),
            )
            conn.commit()

    def _start(self, folder: Path, **body: object) -> object:
        payload = {"instruction": "Rewrite in present tense.", **body}
        return client.post(f"/api/automation/edit-captions?path={quote(str(folder))}", json=payload)

    def test_requires_supported_media(self) -> None:
        with TempMediaFolder() as root:
            response = self._start(root)

            self.assertEqual(response.status_code, 400)
            self.assertIn("No supported images or videos", response.json()["detail"])

    def test_requires_an_instruction(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, instruction="   ")

            self.assertEqual(response.status_code, 400)
            self.assertIn("instruction", response.json()["detail"])

    def test_starts_the_job(self) -> None:
        with TempMediaFolder() as root:
            media = write_media(root, "photo.png")
            write_txt_caption(media, "A woman walked along the street.")

            with _patched_job_runner("edit_captions", _noop_runner):
                response = self._start(root)

                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["job_type"], "edit_captions")
                wait_for_job(payload["id"])


class WatermarkAutomationEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key LIKE ?",
                (f"{AUTOMATION_SETTINGS_KEY_PREFIX}.%",),
            )
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
                _stored_settings(root)["watermark"],
                {
                    "text": "Sample Studio",
                    "size": "large",
                    "opacity": 25,
                    "position": "center",
                },
            )

    def test_a_refused_start_does_not_store_the_settings(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            refused = self._start(root, text="   ", size="large")

            self.assertEqual(refused.status_code, 400)
            # Storing before queueing would have kept the size of a run that never happened.
            self.assertEqual(_stored_settings(root)["watermark"]["size"], "medium")


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

    def test_rejects_a_model_with_no_template(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, model="no_such_model")

            # The wire union rejects it before the job is ever queued.
            self.assertEqual(response.status_code, 422)

    def test_forwards_the_chosen_model_to_the_runner(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            seen: list[object] = []

            def capture(folder: Path, **params: object) -> dict[str, object]:
                seen.append(params.get("model"))
                return {
                    "folder": str(folder),
                    "total": 0,
                    "processed": 0,
                    "stats": {},
                    "results": [],
                }

            with _patched_job_runner("train_lora", capture):
                response = self._start(root, model="h3_fl2va")
                wait_for_job(response.json()["id"])

            self.assertEqual(seen, ["h3_fl2va"])

    def test_forwards_an_edited_template_to_the_runner(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")
            seen: list[object] = []

            def capture(folder: Path, **params: object) -> dict[str, object]:
                seen.append(params.get("template"))
                return {
                    "folder": str(folder),
                    "total": 0,
                    "processed": 0,
                    "stats": {},
                    "results": [],
                }

            edited = "config:\n  process:\n    - datasets:\n        - {}\n      sample: {}\n"
            with _patched_job_runner("train_lora", capture):
                response = self._start(root, template=edited)
                wait_for_job(response.json()["id"])

            self.assertEqual(seen, [edited])

    def test_rejects_a_broken_edited_template_before_queueing(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            response = self._start(root, template="a: [1, 2")

            self.assertEqual(response.status_code, 400)
            self.assertIn("not valid YAML", response.json()["detail"])

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


class TrainingTemplateEndpointTests(unittest.TestCase):
    """The editor reads a template here and checks its edit before the job is started."""

    def test_returns_the_template_as_written(self) -> None:
        response = client.get("/api/automation/train-lora/template?model=h3_fl2va")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "h3_fl2va")
        # Raw text, not a re-dump: the comments are half of what makes it editable.
        self.assertIn('arch: "minimax_h3"', payload["yaml"])

    def test_defaults_to_the_krea2_turbo_template(self) -> None:
        response = client.get("/api/automation/train-lora/template")

        self.assertEqual(response.json()["model"], "krea2_turbo")
        self.assertIn("krea/Krea-2-Turbo", response.json()["yaml"])

    def test_rejects_a_model_with_no_template(self) -> None:
        response = client.get("/api/automation/train-lora/template?model=no_such_model")

        self.assertEqual(response.status_code, 422)

    def test_a_usable_edit_checks_out(self) -> None:
        template = client.get("/api/automation/train-lora/template").json()["yaml"]

        response = client.post(
            "/api/automation/train-lora/template/check", json={"template": template}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "error": None})

    def test_a_broken_edit_answers_200_with_the_reason(self) -> None:
        """Not an HTTP error: an unparseable draft is the expected answer here."""
        response = client.post(
            "/api/automation/train-lora/template/check", json={"template": "a: [1, 2"}
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("edited training template", payload["error"])

    def test_a_template_missing_a_block_names_the_block(self) -> None:
        response = client.post(
            "/api/automation/train-lora/template/check",
            json={"template": "config:\n  process:\n    - datasets:\n        - {}\n"},
        )

        self.assertFalse(response.json()["ok"])
        self.assertIn("sample", response.json()["error"])


class ComfyPresetsEndpointTests(unittest.TestCase):
    """What the dialog reads before it can offer a workflow."""

    def test_lists_the_presets_on_disk(self) -> None:
        with patch("routes.automation.probe_available", return_value=True):
            response = client.get("/api/automation/comfy-process/presets")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("example-lanczos-2x", [preset["name"] for preset in payload["presets"]])
        self.assertTrue(payload["available"])

    def test_names_the_origin_it_probed(self) -> None:
        """A bare "not answering" cannot tell a stopped ComfyUI from a wrong port."""
        with (
            patch("routes.automation.probe_available", return_value=False),
            patch.dict(os.environ, {"COMFY_BASE_URL": "http://127.0.0.1:9123"}),
        ):
            response = client.get("/api/automation/comfy-process/presets")

        payload = response.json()
        self.assertFalse(payload["available"])
        self.assertEqual(payload["base_url"], "http://127.0.0.1:9123")

    def test_carries_the_origin_even_when_comfy_answers(self) -> None:
        with (
            patch("routes.automation.probe_available", return_value=True),
            patch.dict(os.environ, {"COMFY_BASE_URL": "http://gpu-box:8188/"}),
        ):
            response = client.get("/api/automation/comfy-process/presets")

        self.assertEqual(response.json()["base_url"], "http://gpu-box:8188")


if __name__ == "__main__":
    unittest.main()


#: One non-default start body per job type, with the endpoint that accepts it. Keyed by
#: job type so ``JobSettingsPersistenceTests`` can assert it covers the whole registry.
_NON_DEFAULT_STARTS: dict[str, tuple[str, dict[str, object]]] = {
    "auto_caption": (
        "auto-caption",
        {
            "mode": "instruct",
            "reasoning_effort": "low",
            "preserve_thinking": False,
            "caption_audio": True,
        },
    ),
    "set_captions": ("set-captions", {"caption": "A mountain lake.", "overwrite": True}),
    "replace_captions": (
        "replace-captions",
        {
            "mode": "append",
            "search": "lake",
            "replacement": "river",
            "use_regex": True,
            "case_sensitive": True,
        },
    ),
    "backup_captions": ("backup-captions", {"overwrite": True}),
    "verify_captions": (
        "verify-captions",
        {
            "mode": "thinking",
            "context": "Studio product shots.",
            "reasoning_effort": "low",
            "preserve_thinking": False,
        },
    ),
    "edit_captions": (
        "edit-captions",
        {
            "mode": "thinking",
            "reasoning_effort": "low",
            "preserve_thinking": False,
            "instruction": "Rewrite in present tense.",
            "backup": False,
        },
    ),
    "batch_rename": ("batch-rename", {"stem": "shot", "start_number": 7}),
    "find_duplicates": ("find-duplicates", {"threshold": "loose"}),
    "train_lora": (
        "train-lora",
        {
            "lora_name": "sample_train_v1",
            "trigger_word": "mtnstyle",
            "prompts": ["a mountain lake at sunrise"],
            "model": "h3_fl2va",
        },
    ),
    "watermark": (
        "watermark",
        {"text": "Sample Studio", "size": "large", "opacity": 75, "position": "top"},
    ),
    # The preset has to be a real file: queue-time validation parses it, and only the
    # runner is patched out. The shipped example doubles as the fixture, so a broken
    # example fails here rather than in the user's dialog.
    "comfy_process": (
        "comfy-process",
        {
            "preset": "example-lanczos-2x",
            "seed": 1234,
            # The example preset has no prompt node, and a non-empty prompt would be
            # refused with a 400 rather than remembered.
            "prompt_text": "",
            "overwrite_candidates": True,
        },
    ),
}


def _noop_runner(folder: Path, **params: object) -> dict[str, object]:
    return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}


class JobSettingsPersistenceTests(unittest.TestCase):
    """Every job with a dialog remembers what it ran with, for this folder and the next.

    Table-driven on purpose: a new job type that registers settings but never stores
    them fails here, which is the guarantee the per-folder settings rest on.
    """

    def setUp(self) -> None:
        reset_job_manager()

    def tearDown(self) -> None:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM preferences WHERE key LIKE ?",
                (f"{AUTOMATION_SETTINGS_KEY_PREFIX}.%",),
            )
            conn.commit()

    def test_the_table_covers_every_job_that_registers_settings(self) -> None:
        self.assertEqual(set(_NON_DEFAULT_STARTS), set(JOB_SETTINGS_MODELS))

    def _run(self, job_type: str, folder: Path) -> dict:
        endpoint, body = _NON_DEFAULT_STARTS[job_type]
        write_sysprompt(folder, "Describe the scene.")
        media = write_media(folder, "photo.png")
        write_txt_caption(media, "A lake.")

        with _patched_job_runner(job_type, _noop_runner):
            response = client.post(
                f"/api/automation/{endpoint}?path={quote(str(folder))}", json=body
            )
            self.assertEqual(response.status_code, 200, response.text)
            wait_for_job(response.json()["id"])

        return body

    def test_every_job_remembers_its_settings_for_the_folder_it_ran_in(self) -> None:
        for job_type, model in JOB_SETTINGS_MODELS.items():
            with self.subTest(job_type=job_type), TempMediaFolder() as root:
                body = self._run(job_type, root)

                stored = _stored_settings(root)[job_type]
                remembered = {
                    name: value for name, value in body.items() if name in model.model_fields
                }
                self.assertEqual(stored, remembered)
                # Anything left out of the settings model is a field we never store.
                self.assertEqual(set(stored), set(model.model_fields))

    def test_a_folder_with_no_run_of_its_own_starts_from_the_last_one(self) -> None:
        for job_type, model in JOB_SETTINGS_MODELS.items():
            with self.subTest(job_type=job_type):
                with TempMediaFolder() as used:
                    body = self._run(job_type, used)
                with TempMediaFolder() as fresh:
                    stored = _stored_settings(fresh)[job_type]

                self.assertEqual(
                    stored,
                    {name: value for name, value in body.items() if name in model.model_fields},
                )

    def test_the_destructive_fields_are_never_remembered(self) -> None:
        # Each of these must be re-chosen every run: two overwrite toggles, the LoRA
        # name (the job's resume key) and a per-run template override.
        never_stored = {"overwrite", "backup", "lora_name", "template", "paths"}
        stored_fields = {
            name for model in JOB_SETTINGS_MODELS.values() for name in model.model_fields
        }

        self.assertEqual(stored_fields & never_stored, set())

    def test_a_run_that_set_overwrite_still_reads_back_without_it(self) -> None:
        for job_type in ("set_captions", "backup_captions"):
            with self.subTest(job_type=job_type), TempMediaFolder() as root:
                self._run(job_type, root)

                self.assertNotIn("overwrite", _stored_settings(root)[job_type])
