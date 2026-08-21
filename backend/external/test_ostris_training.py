from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from external.ostris_training import (
    OstrisTrainingError,
    build_training_config,
    create_and_start_training,
    list_training_samples,
    load_training_template,
    validate_lora_name,
)


def _template() -> dict[str, object]:
    return {
        "job": "extension",
        "config": {
            "name": "",
            "process": [
                {
                    "type": "diffusion_trainer",
                    "training_folder": "",
                    "trigger_word": None,
                    "datasets": [{"folder_path": "", "caption_ext": "txt"}],
                    "train": {"steps": 1000},
                    "model": {"name_or_path": "krea/Krea-2-Turbo"},
                    "sample": {"sample_every": 250, "samples": [{"prompt": "example prompt"}]},
                }
            ],
        },
        "meta": {"name": "[name]", "version": "1.0"},
    }


class LoadTrainingTemplateTests(unittest.TestCase):
    def test_loads_the_shipped_krea2_turbo_template(self) -> None:
        template = load_training_template()

        process = template["config"]["process"][0]
        self.assertEqual(process["type"], "diffusion_trainer")
        self.assertEqual(process["model"]["name_or_path"], "krea/Krea-2-Turbo")
        self.assertEqual(process["train"]["steps"], 1000)
        self.assertEqual(process["sample"]["sample_every"], 200)

    def test_rejects_an_unknown_model(self) -> None:
        with self.assertRaises(OstrisTrainingError):
            load_training_template("no_such_model")


class BuildTrainingConfigTests(unittest.TestCase):
    def test_fills_placeholders_and_leaves_everything_else_alone(self) -> None:
        template = _template()

        config = build_training_config(
            template,
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="sampletoken",
            prompts=["a mountain lake at sunrise", "a red hatchback on a wet street"],
        )

        process = config["config"]["process"][0]
        self.assertEqual(config["config"]["name"], "sample_train_v1")
        self.assertEqual(config["meta"]["name"], "sample_train_v1")
        self.assertEqual(process["training_folder"], "C:\\AI-Toolkit\\output")
        self.assertEqual(process["trigger_word"], "sampletoken")
        self.assertEqual(process["datasets"][0]["folder_path"], "C:\\datasets\\landscapes")
        self.assertEqual(
            process["sample"]["samples"],
            [
                {"prompt": "a mountain lake at sunrise"},
                {"prompt": "a red hatchback on a wet street"},
            ],
        )

        # Untouched settings keep the template's values.
        self.assertEqual(process["train"]["steps"], 1000)
        self.assertEqual(process["sample"]["sample_every"], 250)
        self.assertEqual(process["datasets"][0]["caption_ext"], "txt")
        self.assertEqual(process["model"]["name_or_path"], "krea/Krea-2-Turbo")

    def test_blank_trigger_word_becomes_null(self) -> None:
        config = build_training_config(
            _template(),
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="   ",
            prompts=["a mountain lake at sunrise"],
        )

        self.assertIsNone(config["config"]["process"][0]["trigger_word"])

    def test_does_not_mutate_the_template(self) -> None:
        template = _template()

        build_training_config(
            template,
            name="sample_train_v1",
            training_folder="C:\\AI-Toolkit\\output",
            dataset_folder="C:\\datasets\\landscapes",
            trigger_word="",
            prompts=["a mountain lake at sunrise"],
        )

        self.assertEqual(template["config"]["name"], "")
        self.assertEqual(template["config"]["process"][0]["datasets"][0]["folder_path"], "")


class CreateAndStartTrainingTests(unittest.TestCase):
    def test_creates_queues_and_starts_the_gpu_queue(self) -> None:
        client = Mock()
        client.post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "job-1"}))
        client.get.return_value = Mock(raise_for_status=Mock())

        job_id = create_and_start_training(client, name="sample_train_v1", gpu_ids="0", config={})

        self.assertEqual(job_id, "job-1")
        requested = [str(call.args[0]) for call in client.get.call_args_list]
        self.assertTrue(any(url.endswith("/api/jobs/job-1/start") for url in requested))
        self.assertTrue(any(url.endswith("/api/queue/0/start") for url in requested))

    def test_reports_a_duplicate_name_clearly(self) -> None:
        client = Mock()
        client.post.return_value = Mock(status_code=409)

        with self.assertRaises(OstrisTrainingError) as caught:
            create_and_start_training(client, name="sample_train_v1", gpu_ids="0", config={})

        self.assertIn("already exists", str(caught.exception))
        client.get.assert_not_called()


class ListTrainingSamplesTests(unittest.TestCase):
    def test_returns_only_the_latest_step_in_prompt_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            for filename in (
                "1780000000000__000000250_0.jpg",
                "1780000000000__000000250_1.jpg",
                "1780000600000__000000500_1.jpg",
                "1780000600000__000000500_0.jpg",
                "notes.txt",
            ):
                (samples_folder / filename).write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise", "a red hatchback on a wet street"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(
            [sample["name"] for sample in samples],
            ["1780000600000__000000500_0.jpg", "1780000600000__000000500_1.jpg"],
        )
        self.assertEqual(samples[0]["prompt"], "a mountain lake at sunrise")
        self.assertEqual(samples[1]["prompt"], "a red hatchback on a wet street")

    def test_uses_a_blank_prompt_when_the_job_config_is_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.jpg").write_text("", encoding="utf-8")

            samples, _ = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual(samples[0]["prompt"], "")

    def test_returns_nothing_before_the_first_sample(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples, step = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual(samples, [])
        self.assertIsNone(step)

    def test_prefers_the_video_when_a_still_preview_shares_the_stem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            for filename in (
                "1780000600000__000000500_0.jpg",
                "1780000600000__000000500_0.mp4",
                "1780000600000__000000500_1.jpg",
                "1780000600000__000000500_1.mp4",
            ):
                (samples_folder / filename).write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise", "a red hatchback on a wet street"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(
            [sample["name"] for sample in samples],
            ["1780000600000__000000500_0.mp4", "1780000600000__000000500_1.mp4"],
        )
        self.assertEqual(samples[0]["prompt"], "a mountain lake at sunrise")
        self.assertEqual(samples[1]["prompt"], "a red hatchback on a wet street")

    def test_keeps_a_video_sample_when_there_is_no_still(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.mp4").write_text("", encoding="utf-8")

            samples, step = list_training_samples(
                tmp,
                "sample_train_v1",
                ["a mountain lake at sunrise"],
            )

        self.assertEqual(step, 500)
        self.assertEqual(samples[0]["name"], "1780000600000__000000500_0.mp4")

    def test_ignores_a_sidecar_that_shares_the_sample_stem(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples_folder = Path(tmp) / "sample_train_v1" / "samples"
            samples_folder.mkdir(parents=True)
            (samples_folder / "1780000600000__000000500_0.jpg").write_text("", encoding="utf-8")
            (samples_folder / "1780000600000__000000500_0.txt").write_text("", encoding="utf-8")

            samples, _ = list_training_samples(tmp, "sample_train_v1", [])

        self.assertEqual([sample["name"] for sample in samples], ["1780000600000__000000500_0.jpg"])


class ValidateLoraNameTests(unittest.TestCase):
    def test_rejects_names_that_would_escape_the_training_folder(self) -> None:
        for name in ("", "..", ".", "sub/name", "sub\\name", "name?"):
            with self.assertRaises(ValueError):
                validate_lora_name(name)

    def test_accepts_a_plain_name(self) -> None:
        validate_lora_name("sample_train_v1")


if __name__ == "__main__":
    unittest.main()
