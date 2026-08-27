from __future__ import annotations

import unittest

from automation_settings import (
    JOB_SETTINGS_MODELS,
    automation_settings_key,
    get_automation_settings,
    remember_job_settings,
)
from db import get_connection
from schemas import (
    AutoCaptionStartRequest,
    AutomationSettingsResponse,
    BackupCaptionsStartRequest,
    BatchRenameStartRequest,
    ComfyProcessStartRequest,
    EditCaptionsStartRequest,
    FindDuplicatesStartRequest,
    ReplaceCaptionsStartRequest,
    SetCaptionsStartRequest,
    TrainLoraStartRequest,
    VerifyCaptionsStartRequest,
    WatermarkStartRequest,
)

#: Every job whose dialog has settings, paired with the start request that carries them.
START_REQUESTS = {
    "auto_caption": AutoCaptionStartRequest,
    "set_captions": SetCaptionsStartRequest,
    "replace_captions": ReplaceCaptionsStartRequest,
    "backup_captions": BackupCaptionsStartRequest,
    "verify_captions": VerifyCaptionsStartRequest,
    "edit_captions": EditCaptionsStartRequest,
    "batch_rename": BatchRenameStartRequest,
    "find_duplicates": FindDuplicatesStartRequest,
    "train_lora": TrainLoraStartRequest,
    "watermark": WatermarkStartRequest,
    "comfy_process": ComfyProcessStartRequest,
}


def _clear() -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM preferences WHERE key LIKE ?", ("automation_settings.%",))
        conn.commit()


class RegistryShapeTests(unittest.TestCase):
    def test_the_registry_and_the_response_name_the_same_jobs(self) -> None:
        response_jobs = set(AutomationSettingsResponse.model_fields) - {"folder_path"}

        self.assertEqual(set(JOB_SETTINGS_MODELS), response_jobs)

    def test_every_response_field_holds_its_registered_model(self) -> None:
        for job_type, model in JOB_SETTINGS_MODELS.items():
            with self.subTest(job_type=job_type):
                field = AutomationSettingsResponse.model_fields[job_type]

                self.assertIs(field.annotation, model)

    def test_every_job_with_a_dialog_is_registered(self) -> None:
        # If a tenth dialog appears and forgets to register, this is where it fails.
        self.assertEqual(set(JOB_SETTINGS_MODELS), set(START_REQUESTS))

    def test_every_start_request_inherits_its_settings_model(self) -> None:
        # This is what makes the ``include=`` slice in ``remember_job_settings`` total.
        for job_type, start in START_REQUESTS.items():
            with self.subTest(job_type=job_type):
                self.assertTrue(issubclass(start, JOB_SETTINGS_MODELS[job_type]))

    def test_the_destructive_fields_are_never_part_of_any_settings_model(self) -> None:
        stored = {name for model in JOB_SETTINGS_MODELS.values() for name in model.model_fields}

        self.assertEqual(stored & {"overwrite", "backup", "lora_name", "template", "paths"}, set())

    def test_backup_captions_registers_with_nothing_to_remember(self) -> None:
        # It is registered purely so every job travels the same path.
        self.assertEqual(JOB_SETTINGS_MODELS["backup_captions"].model_fields, {})

    def test_the_keys_are_namespaced_per_job(self) -> None:
        self.assertEqual(automation_settings_key("watermark"), "automation_settings.watermark")


class RememberJobSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear()

    def tearDown(self) -> None:
        _clear()

    def test_it_stores_only_the_settings_slice_of_a_start_request(self) -> None:
        body = TrainLoraStartRequest(
            paths=[r"C:\Photos\one.png"],
            lora_name="sample_v1",
            trigger_word="mtnstyle",
            prompts=["a mountain lake"],
            model="h3_fl2va",
        )

        remember_job_settings("train_lora", body, folder_path=r"C:\Photos")

        stored = get_automation_settings(folder_path=r"C:\Photos").train_lora
        self.assertEqual(stored.trigger_word, "mtnstyle")
        self.assertEqual(stored.model, "h3_fl2va")
        self.assertEqual(stored.prompts, ["a mountain lake"])
        self.assertNotIn("lora_name", stored.model_dump())
        self.assertNotIn("template", stored.model_dump())

    def test_an_unregistered_job_type_is_a_no_op(self) -> None:
        for job_type in ("strip_metadata", "restore_captions", "not_a_job"):
            with self.subTest(job_type=job_type):
                remember_job_settings(
                    job_type, SetCaptionsStartRequest(caption="x"), folder_path=r"C:\Photos"
                )

                self.assertEqual(
                    get_automation_settings(folder_path=r"C:\Photos").set_captions.caption, ""
                )

    def test_settings_are_scoped_to_their_folder(self) -> None:
        remember_job_settings(
            "set_captions", SetCaptionsStartRequest(caption="lake"), folder_path=r"C:\Photos"
        )
        remember_job_settings(
            "set_captions", SetCaptionsStartRequest(caption="city"), folder_path=r"C:\Renders"
        )

        self.assertEqual(
            get_automation_settings(folder_path=r"C:\Photos").set_captions.caption, "lake"
        )
        self.assertEqual(
            get_automation_settings(folder_path=r"C:\Renders").set_captions.caption, "city"
        )

    def test_an_untouched_folder_reads_the_most_recent_settings(self) -> None:
        remember_job_settings(
            "find_duplicates",
            FindDuplicatesStartRequest(threshold="loose"),
            folder_path=r"C:\Photos",
        )

        fresh = get_automation_settings(folder_path=r"C:\Somewhere\Else")
        self.assertEqual(fresh.find_duplicates.threshold, "loose")
        # Jobs that have never run anywhere still read their own defaults.
        self.assertEqual(fresh.watermark.size, "medium")

    def test_the_response_reports_the_canonical_folder_key(self) -> None:
        self.assertTrue(get_automation_settings(folder_path="C:/Photos").folder_path)


if __name__ == "__main__":
    unittest.main()
