from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from automation.train_lora import run_train_lora_job, validate_train_lora_folder
from external.ostris_training import (
    TRAINING_TEMPLATES,
    OstrisTrainingError,
    read_training_template_text,
)
from testing_fixtures import TempMediaFolder, isolate_test_database, write_media

isolate_test_database()

TRAINING_FOLDER = "C:\\AI-Toolkit\\output"
PROMPTS = ["a mountain lake at sunrise", "a red hatchback on a wet street"]


def _job(status: str, *, step: int = 0, total_steps: int | None = 100, **extra: object) -> dict:
    return {
        "id": "job-1",
        "name": "sample_train_v1",
        "status": status,
        "step": step,
        "total_steps": total_steps,
        **extra,
    }


def _job_with_config_steps(
    status: str,
    *,
    step: int = 0,
    config_steps: int = 1000,
) -> dict:
    """Raw Ostris payload shape: total lives in job_config, not top-level total_steps."""
    return {
        "id": "job-1",
        "name": "sample_train_v1",
        "status": status,
        "step": step,
        "job_config": json.dumps(
            {
                "config": {
                    "process": [
                        {
                            "type": "diffusion_trainer",
                            "train": {"steps": config_steps},
                        }
                    ]
                }
            }
        ),
    }


class TrainLoraPatches:
    """Patches every AI-Toolkit call the runner makes, so no network is touched."""

    def __init__(self, *, poll_jobs: list[dict | None], existing: dict | None = None) -> None:
        self.poll_jobs = poll_jobs
        self.existing = existing
        self.stopped_with_checkpoint: list[str] = []
        self.marked_stopped: list[str] = []
        self.created: list[dict] = []

    def __enter__(self) -> TrainLoraPatches:
        remaining = list(self.poll_jobs)

        def fetch_job(_client: object, _job_id: str) -> dict | None:
            return remaining.pop(0) if remaining else None

        def create(_client: object, *, name: str, gpu_ids: str, config: dict) -> str:
            self.created.append({"name": name, "gpu_ids": gpu_ids, "config": config})
            return "job-1"

        self._patches = [
            patch("automation.train_lora.httpx.Client"),
            patch(
                "automation.train_lora.fetch_ostris_training_folder",
                return_value=TRAINING_FOLDER,
            ),
            patch("automation.train_lora.fetch_ostris_gpu_ids", return_value="0"),
            patch("automation.train_lora.fetch_ostris_job_by_name", return_value=self.existing),
            patch("automation.train_lora.fetch_ostris_job", side_effect=fetch_job),
            patch("automation.train_lora.create_and_start_training", side_effect=create),
            patch(
                "automation.train_lora.stop_ostris_job_with_checkpoint",
                side_effect=lambda job_id: self.stopped_with_checkpoint.append(job_id),
            ),
            patch(
                "automation.train_lora.mark_ostris_job_stopped",
                side_effect=lambda _client, job_id: self.marked_stopped.append(job_id),
            ),
            patch("automation.train_lora.list_training_samples", return_value=([], None)),
        ]
        for item in self._patches:
            item.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        for item in reversed(self._patches):
            item.stop()


class ValidateTrainLoraFolderTests(unittest.TestCase):
    def test_requires_media_in_the_folder(self) -> None:
        with TempMediaFolder() as root:
            with self.assertRaises(ValueError) as caught:
                validate_train_lora_folder(root, lora_name="sample_train_v1", prompts=PROMPTS)

        self.assertIn("No supported images or videos", str(caught.exception))

    def test_requires_a_name(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaises(ValueError) as caught:
                validate_train_lora_folder(root, lora_name="  ", prompts=PROMPTS)

        self.assertIn("name", str(caught.exception))

    def test_requires_at_least_one_prompt(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaises(ValueError) as caught:
                validate_train_lora_folder(root, lora_name="sample_train_v1", prompts=["   "])

        self.assertIn("prompt", str(caught.exception))

    def test_rejects_a_model_with_no_template(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaises(ValueError) as caught:
                validate_train_lora_folder(
                    root, lora_name="sample_train_v1", prompts=PROMPTS, model="no_such_model"
                )

        self.assertIn("no_such_model", str(caught.exception))

    def test_accepts_every_registered_model(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            for model in TRAINING_TEMPLATES:
                validate_train_lora_folder(
                    root, lora_name="sample_train_v1", prompts=PROMPTS, model=model
                )

    def test_rejects_a_broken_edited_template(self) -> None:
        """Caught at queue time, so the user sees it on the dialog they are looking at."""
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            with self.assertRaises(ValueError) as caught:
                validate_train_lora_folder(
                    root, lora_name="sample_train_v1", prompts=PROMPTS, template="a: [1, 2"
                )

        self.assertIn("not valid YAML", str(caught.exception))

    def test_accepts_a_valid_edited_template(self) -> None:
        with TempMediaFolder() as root:
            write_media(root, "photo.png")

            validate_train_lora_folder(
                root,
                lora_name="sample_train_v1",
                prompts=PROMPTS,
                template=read_training_template_text("krea2_turbo"),
            )


class TrainingConfigTests(unittest.TestCase):
    """The config handed to AI-Toolkit is built for real here - only the request is faked."""

    def _created_config(self, **kwargs: object) -> dict:
        with TrainLoraPatches(poll_jobs=[_job("completed", step=100)]) as patches:
            run_train_lora_job(
                Path("C:\\datasets\\landscapes"),
                lora_name="sample_train_v1",
                trigger_word="mtnstyle",
                prompts=PROMPTS,
                poll_interval_seconds=0,
                **kwargs,
            )

        self.assertEqual(len(patches.created), 1)
        return patches.created[0]["config"]["config"]["process"][0]

    def test_defaults_to_the_krea2_turbo_template(self) -> None:
        self.assertEqual(self._created_config()["model"]["arch"], "krea2:turbo")

    def test_the_chosen_model_picks_its_template(self) -> None:
        process = self._created_config(model="h3_fl2va")

        self.assertEqual(process["model"]["arch"], "minimax_h3")
        self.assertEqual(process["model"]["name_or_path"], "Comfy-Org/MiniMax-H3")
        # Video settings ride along from the YAML; exact frame counts are pinned in test_ostris_training.
        self.assertTrue(process["datasets"][0]["do_i2v"])
        self.assertGreater(process["sample"]["num_frames"], 1)

    def test_an_edited_template_replaces_the_shipped_one(self) -> None:
        edited = read_training_template_text("krea2_turbo").replace("steps: 1000", "steps: 250")

        process = self._created_config(template=edited)

        self.assertEqual(process["train"]["steps"], 250)
        # Still the model it was edited from, and the placeholders still get filled.
        self.assertEqual(process["model"]["arch"], "krea2:turbo")
        self.assertEqual(process["datasets"][0]["folder_path"], "C:\\datasets\\landscapes")

    def test_an_edited_template_wins_over_the_model_slug(self) -> None:
        """The edit is the whole config; the slug only picks what to start from."""
        edited = read_training_template_text("h3_fl2va")

        process = self._created_config(model="krea2_turbo", template=edited)

        self.assertEqual(process["model"]["arch"], "minimax_h3")

    def test_placeholders_are_filled_whichever_model_is_chosen(self) -> None:
        for model in TRAINING_TEMPLATES:
            process = self._created_config(model=model)

            self.assertEqual(process["training_folder"], TRAINING_FOLDER)
            self.assertEqual(process["datasets"][0]["folder_path"], "C:\\datasets\\landscapes")
            self.assertEqual(process["trigger_word"], "mtnstyle")
            self.assertEqual([entry["prompt"] for entry in process["sample"]["samples"]], PROMPTS)


class RunTrainLoraJobTests(unittest.TestCase):
    def _run(self, patches: TrainLoraPatches, **kwargs: object) -> dict:
        return run_train_lora_job(
            Path("C:\\datasets\\landscapes"),
            lora_name="sample_train_v1",
            prompts=PROMPTS,
            poll_interval_seconds=0,
            **kwargs,
        )

    def test_reports_progress_from_the_training_steps(self) -> None:
        progress: list[tuple[int, int]] = []

        with TrainLoraPatches(
            poll_jobs=[_job("running", step=40), _job("completed", step=100)]
        ) as patches:
            result = self._run(
                patches,
                on_progress=lambda _file, _name, processed, total, _stats: progress.append(
                    (processed, total)
                ),
            )

        # The first entry is the job as it looked right after being queued.
        self.assertEqual(progress, [(40, 100), (100, 100)])
        self.assertEqual(result["processed"], 100)
        self.assertEqual(result["total"], 100)
        self.assertEqual(result["stats"]["stopped"], 0)

    def test_resolves_total_steps_from_job_config_when_top_level_is_missing(self) -> None:
        progress: list[tuple[int, int]] = []

        with TrainLoraPatches(
            poll_jobs=[
                _job_with_config_steps("running", step=50, config_steps=1000),
                _job_with_config_steps("completed", step=1000, config_steps=1000),
            ]
        ) as patches:
            result = self._run(
                patches,
                on_progress=lambda _file, _name, processed, total, _stats: progress.append(
                    (processed, total)
                ),
            )

        self.assertEqual(progress, [(50, 1000), (1000, 1000)])
        self.assertEqual(result["processed"], 1000)
        self.assertEqual(result["total"], 1000)
        self.assertEqual(result["stats"]["total_steps"], 1000)

    def test_records_ostris_speed_as_ms_per_step_for_remaining_time(self) -> None:
        progress_stats: list[dict[str, int]] = []

        with TrainLoraPatches(
            poll_jobs=[
                _job("running", step=40, speed_string="2.15 sec/iter"),
                _job("completed", step=100, speed_string="2.15 sec/iter"),
            ]
        ) as patches:
            self._run(
                patches,
                on_progress=lambda _file, _name, _processed, _total, stats: progress_stats.append(
                    dict(stats)
                ),
            )

        self.assertEqual(progress_stats[0]["speed_ms_per_step"], 2150)

    def test_passes_the_dataset_folder_and_prompts_to_ai_toolkit(self) -> None:
        with TrainLoraPatches(poll_jobs=[_job("completed", step=100)]) as patches:
            self._run(patches, trigger_word="sampletoken")

        self.assertEqual(len(patches.created), 1)
        config = patches.created[0]["config"]
        process = config["config"]["process"][0]
        self.assertEqual(patches.created[0]["name"], "sample_train_v1")
        self.assertEqual(process["datasets"][0]["folder_path"], "C:\\datasets\\landscapes")
        self.assertEqual(process["training_folder"], TRAINING_FOLDER)
        self.assertEqual(process["trigger_word"], "sampletoken")
        self.assertEqual([item["prompt"] for item in process["sample"]["samples"]], PROMPTS)

    def test_a_failed_run_raises_with_the_reason_ai_toolkit_gave(self) -> None:
        with TrainLoraPatches(
            poll_jobs=[_job("error", step=12, info="CUDA out of memory")]
        ) as patches:
            with self.assertRaises(OstrisTrainingError) as caught:
                self._run(patches)

        self.assertIn("CUDA out of memory", str(caught.exception))

    def test_cancelling_a_running_job_saves_a_checkpoint_first(self) -> None:
        with TrainLoraPatches(
            poll_jobs=[
                _job("running", step=40),
                _job("running", step=60),
                _job("stopped", step=60),
            ]
        ) as patches:
            result = self._run(patches, should_cancel=lambda: True)

        self.assertEqual(patches.stopped_with_checkpoint, ["job-1"])
        self.assertEqual(patches.marked_stopped, [])
        self.assertEqual(result["stats"]["stopped"], 1)

    def test_cancelling_a_queued_job_drops_it_from_the_queue(self) -> None:
        with TrainLoraPatches(
            poll_jobs=[_job("queued"), _job("stopped")],
        ) as patches:
            self._run(patches, should_cancel=lambda: True)

        self.assertEqual(patches.marked_stopped, ["job-1"])
        self.assertEqual(patches.stopped_with_checkpoint, [])

    def test_attaches_to_a_live_run_instead_of_creating_a_second_one(self) -> None:
        with TrainLoraPatches(
            poll_jobs=[_job("running", step=80), _job("completed", step=100)],
            existing=_job("running", step=80),
        ) as patches:
            result = self._run(patches, attach_only=True)

        self.assertEqual(patches.created, [])
        self.assertEqual(result["processed"], 100)

    def test_attaching_to_a_finished_run_reports_it_as_finished(self) -> None:
        with TrainLoraPatches(
            poll_jobs=[],
            existing=_job("completed", step=100),
        ) as patches:
            result = self._run(patches, attach_only=True)

        self.assertEqual(patches.created, [])
        self.assertEqual(result["processed"], 100)
        self.assertEqual(result["stats"]["stopped"], 0)

    def test_attaching_reports_a_run_ai_toolkit_no_longer_knows(self) -> None:
        with TrainLoraPatches(poll_jobs=[], existing=None) as patches:
            with self.assertRaises(OstrisTrainingError) as caught:
                self._run(patches, attach_only=True)

        self.assertIn("no longer", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
