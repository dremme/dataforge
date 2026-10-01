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
from automation.jobs import JOB_SPECS, job_manager
from automation_settings import AUTOMATION_SETTINGS_KEY_PREFIX, JOB_SETTINGS_MODELS
from routes._test_client import client
from testing_fixtures import (
    TempMediaFolder,
    forget_preferences,
    reset_job_manager,
    wait_for_job,
    write_caption_rules,
    write_image,
    write_media,
    write_sysprompt,
    write_txt_caption,
)


@contextmanager
def _patched_job_runner(job_type: str, run: Callable[..., object]) -> Iterator[None]:
    """Swap a job type's runner. JOB_SPECS holds the function, so patching the module cannot."""
    patched = replace(JOB_SPECS[job_type], run=run)
    with patch.dict(JOB_SPECS, {job_type: patched}):
        yield


def _capturing_runner(received: dict[str, object]) -> Callable[..., dict[str, object]]:
    def run(folder: Path, **params: object) -> dict[str, object]:
        received.update(params)
        return {"folder": str(folder), "total": 0, "processed": 0, "stats": {}, "results": []}

    return run


def _post(endpoint: str, folder: Path, body: dict[str, object] | None = None):
    return client.post(f"/api/automation/{endpoint}?path={quote(str(folder))}", json=body)


def _write_captioned_folder(folder: Path) -> Path:
    write_sysprompt(folder, "Describe the scene.")
    media = write_media(folder, "photo.png")
    write_txt_caption(media, "A lake.")
    return media


def _stored_settings(folder: Path) -> dict:
    """Every job's remembered settings for ``folder``, as the dialogs would read them."""
    response = client.get(f"/api/preferences/automation?path={quote(str(folder))}")
    assert response.status_code == 200, response.text
    return response.json()


# One non-default start body per job type, keyed so persistence tests cover the registry.
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
            "template": "config:\n  process:\n    - datasets:\n        - {}\n      sample: {}\n",
        },
    ),
    "watermark": (
        "watermark",
        {
            "text": "Sample Studio",
            "size": "large",
            "opacity": 75,
            "position": "top",
            "strip_metadata": True,
        },
    ),
    # Queue-time validation parses the preset; the shipped example doubles as the fixture.
    "comfy_process": (
        "comfy-process",
        {
            "preset": "example_lanczos_2x",
            "seed": 1234,
            # The example preset has no prompt node; a non-empty prompt would be a 400.
            "prompt_text": "",
            "overwrite_candidates": True,
        },
    ),
    "auto_adjust": ("auto-adjust", {"replace_adjustments": True}),
}


class JobStartEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_job_manager()
        self.addCleanup(forget_preferences, AUTOMATION_SETTINGS_KEY_PREFIX)

    def _start(self, job_type: str, folder: Path) -> tuple[dict, dict[str, object]]:
        endpoint, body = _NON_DEFAULT_STARTS[job_type]
        received: dict[str, object] = {}
        with _patched_job_runner(job_type, _capturing_runner(received)):
            response = _post(endpoint, folder, body)
            self.assertEqual(response.status_code, 200, response.text)
            wait_for_job(response.json()["id"])
        return response.json(), received

    def test_every_body_field_reaches_the_runner(self) -> None:
        for job_type, (_endpoint, body) in _NON_DEFAULT_STARTS.items():
            with self.subTest(job_type=job_type), TempMediaFolder() as root:
                _write_captioned_folder(root)

                payload, received = self._start(job_type, root)

                self.assertEqual(payload["job_type"], job_type)
                self.assertEqual({name: received[name] for name in body}, body)

    def test_an_empty_body_starts_from_the_request_defaults(self) -> None:
        received: dict[str, object] = {}
        with (
            TempMediaFolder() as root,
            _patched_job_runner("auto_caption", _capturing_runner(received)),
        ):
            _write_captioned_folder(root)

            response = _post("auto-caption", root)
            wait_for_job(response.json()["id"])

        self.assertEqual(response.json()["auto_caption_mode"], "thinking")
        self.assertEqual(received["reasoning_effort"], "medium")
        self.assertIs(received["preserve_thinking"], True)
        self.assertIs(received["caption_audio"], False)

    def test_a_validator_refusal_becomes_a_400_with_its_reason(self) -> None:
        training = {"lora_name": "sample_train_v1", "prompts": ["a lake"]}
        cases = [
            ("auto-caption", {}, ".sysprompt"),
            ("check-caption-rules", {}, ".captionrules"),
            ("replace-captions", {"search": "(unclosed", "use_regex": True}, "Invalid regular"),
            ("backup-captions", {}, "No captions found to back up"),
            ("restore-captions", {}, "No caption backup found"),
            ("edit-captions", {"instruction": "   "}, "instruction"),
            ("watermark", {"text": "  "}, "cannot be empty"),
            ("train-lora", {**training, "lora_name": "..\\secrets"}, "LoRA name"),
            ("train-lora", {**training, "template": "a: [1, 2"}, "not valid YAML"),
        ]
        for endpoint, body, reason in cases:
            with self.subTest(endpoint=endpoint, reason=reason), TempMediaFolder() as root:
                write_media(root, "photo.png")

                response = _post(endpoint, root, body)

                self.assertEqual(response.status_code, 400)
                self.assertIn(reason, response.json()["detail"])

    def test_a_refused_start_does_not_store_the_settings(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            refused = _post("watermark", root, {"text": "   ", "size": "large"})

            self.assertEqual(refused.status_code, 400)
            # Storing before queueing would have kept the size of a run that never happened.
            self.assertEqual(_stored_settings(root)["watermark"]["size"], "medium")


class JobRunEndpointTests(unittest.TestCase):
    """Real runs that only the route can drive: the selection and the stored external ref."""

    def setUp(self) -> None:
        reset_job_manager()

    def test_auto_adjust_adjusts_only_the_selection_and_keeps_its_original(self) -> None:
        with TempMediaFolder() as root:
            chosen = write_image(root, "dusk.png", color=(40, 32, 28))
            write_image(root, "noon.png", color=(40, 32, 28))

            response = _post("auto-adjust", root, {"paths": [str(chosen)]})

            job = wait_for_job(response.json()["id"])
            self.assertTrue((root / "dusk.png.bak").is_file())
            self.assertTrue((root / "dusk.edit.json").is_file())
            self.assertFalse((root / "noon.png.bak").exists())

        self.assertEqual(job.status, "completed")
        self.assertEqual(job.stats["image_success"], 1)

    def test_check_caption_rules_records_the_hits(self) -> None:
        with TempMediaFolder() as root:
            write_caption_rules(root, "flag:\n  - match: [float*]\n")
            write_txt_caption(write_media(root, "photo.png"), "A balloon floating over the hills.")

            response = _post("check-caption-rules", root)
            job = wait_for_job(response.json()["id"])

        self.assertEqual(job.status, "completed")
        self.assertEqual(job.stats["issues_found"], 1)

    def test_restore_starts_once_a_backup_exists(self) -> None:
        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "photo.png"), "A plain caption.")
            run_backup_captions_job(root)

            response = _post("restore-captions", root)
            wait_for_job(response.json()["id"])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job_type"], "restore_captions")

    def test_train_lora_co_tracks_the_external_run(self) -> None:
        def finished(folder: Path, **_params: object) -> dict[str, object]:
            return {
                "folder": str(folder),
                "total": 1000,
                "processed": 1000,
                "stats": {"step": 1000, "stopped": 0},
                "results": [],
            }

        with TempMediaFolder() as root, _patched_job_runner("train_lora", finished):
            write_media(root, "photo.png")

            response = _post(
                "train-lora", root, {"lora_name": "sample_train_v1", "prompts": ["a lake"]}
            )
            job = wait_for_job(response.json()["id"])

        self.assertEqual(response.json()["external_ref"], "sample_train_v1")
        self.assertEqual(job.status, "completed")
        self.assertEqual(job_manager.get_job(job.id).external_ref, "sample_train_v1")


class ReplaceCaptionsPreviewEndpointTests(unittest.TestCase):
    def test_preview_reports_matches(self) -> None:
        with TempMediaFolder() as root:
            write_txt_caption(write_media(root, "photo.png"), "a dog")

            response = _post(
                "replace-captions/preview", root, {"search": "dog", "replacement": "cat"}
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

            response = _post(
                "replace-captions/preview", root, {"search": "(unclosed", "use_regex": True}
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("Invalid regular expression", payload["error"])
        self.assertEqual(payload["matched"], 0)


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


class ComfyPresetsEndpointTests(unittest.TestCase):
    """What the dialog reads before it can offer a workflow."""

    def test_lists_the_presets_on_disk(self) -> None:
        with patch("routes.automation.probe_available", return_value=True):
            response = client.get("/api/automation/comfy-process/presets")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("example_lanczos_2x", [preset["name"] for preset in payload["presets"]])
        self.assertTrue(payload["available"])

    def test_names_the_origin_it_probed(self) -> None:
        """A bare "not answering" cannot tell a stopped ComfyUI from a wrong port."""
        for available, configured, expected in (
            (False, "http://127.0.0.1:9123", "http://127.0.0.1:9123"),
            (True, "http://gpu-box:8188/", "http://gpu-box:8188"),
        ):
            with (
                self.subTest(available=available),
                patch("routes.automation.probe_available", return_value=available),
                patch.dict(os.environ, {"COMFY_BASE_URL": configured}),
            ):
                payload = client.get("/api/automation/comfy-process/presets").json()

                self.assertEqual(payload["available"], available)
                self.assertEqual(payload["base_url"], expected)


class ComfyLogsEndpointTests(unittest.TestCase):
    """What the panel reads while a run works, and what it reads when it cannot."""

    def test_serves_the_tail_of_comfy_output(self) -> None:
        with patch("routes.automation.read_log_lines", return_value=["Phase 3", "done"]):
            response = client.get("/api/automation/comfy-process/logs")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"lines": ["Phase 3", "done"], "available": True})

    def test_unreadable_and_empty_logs_are_both_a_200_but_say_different_things(self) -> None:
        """A stopped or older ComfyUI must leave the panel quiet, not raise a red alert."""
        for lines, available in ((None, False), ([], True)):
            with (
                self.subTest(lines=lines),
                patch("routes.automation.read_log_lines", return_value=lines),
            ):
                response = client.get("/api/automation/comfy-process/logs")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"lines": [], "available": available})


class JobSettingsPersistenceTests(unittest.TestCase):
    """Every job with a dialog remembers what it ran with, for this folder and the next."""

    def setUp(self) -> None:
        reset_job_manager()
        self.addCleanup(forget_preferences, AUTOMATION_SETTINGS_KEY_PREFIX)

    def test_the_table_covers_every_job_that_registers_settings(self) -> None:
        self.assertLessEqual(set(JOB_SETTINGS_MODELS) | {"comfy_process"}, set(_NON_DEFAULT_STARTS))

    def _run(self, job_type: str, folder: Path) -> dict:
        endpoint, body = _NON_DEFAULT_STARTS[job_type]
        _write_captioned_folder(folder)

        with _patched_job_runner(job_type, _capturing_runner({})):
            response = _post(endpoint, folder, body)
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

    def test_comfy_process_remembers_its_settings_under_the_preset(self) -> None:
        with TempMediaFolder() as root:
            body = self._run("comfy_process", root)

            self.assertEqual(
                _stored_settings(root)["comfy_process"],
                {
                    "preset": body["preset"],
                    "overwrite_candidates": body["overwrite_candidates"],
                    "by_preset": {
                        body["preset"]: {"seed": body["seed"], "prompt_text": body["prompt_text"]}
                    },
                },
            )

    def test_a_run_that_set_overwrite_still_reads_back_without_it(self) -> None:
        for job_type in ("set_captions", "backup_captions"):
            with self.subTest(job_type=job_type), TempMediaFolder() as root:
                self._run(job_type, root)

                self.assertNotIn("overwrite", _stored_settings(root)[job_type])


if __name__ == "__main__":
    unittest.main()
